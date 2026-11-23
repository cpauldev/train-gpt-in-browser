const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const archive = path.resolve(process.argv[2] || "release/win-unpacked/resources/app.asar");
const profile = path.resolve(".codex-logs", `desktop-smoke-${process.pid}`);
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app.disableHardwareAcceleration();

// This function is serialized into the isolated renderer.
async function readState() {
  const databases = await indexedDB.databases();
  let files = [];
  if (databases.some((database) => database.name === "train-gpt-in-browser")) {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("train-gpt-in-browser");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      files = await new Promise((resolve, reject) => {
        const request = database.transaction("files", "readonly").objectStore("files").getAll();
        request.onsuccess = () =>
          resolve(
            request.result.map((file) => ({
              name: file.name,
              characters: file.content.length,
            })),
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }
  return {
    title: document.title,
    bridge: typeof window.desktopWindow?.close,
    nodeRequire: typeof window.require,
    files,
  };
}

app.whenReady().then(async () => {
  let window;
  try {
    assert(fs.existsSync(archive), `Build the desktop archive first: ${archive}`);
    window = new BrowserWindow({
      width: 1152,
      height: 960,
      show: false,
      webPreferences: {
        preload: path.join(archive, "electron/preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await window.loadFile(path.join(archive, "dist/index.html"));
    let state;
    const deadline = Date.now() + 30000;
    do {
      state = await window.webContents.executeJavaScript(`(${readState.toString()})()`);
      if (state.files.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    for (const name of ["english_words.txt", "us_baby_names.txt"]) {
      assert(
        state.files.some((file) => file.name === name && file.characters > 100000),
        name,
      );
    }
    assert.equal(state.bridge, "function", "Preload bridge must be available");
    assert.equal(state.nodeRequire, "undefined", "Renderer must remain sandboxed");
    process.stdout.write(
      `${JSON.stringify({ passed: true, archive, title: state.title, datasets: state.files })}\n`,
    );
    window.destroy();
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    window?.destroy();
    app.exit(1);
  }
});
