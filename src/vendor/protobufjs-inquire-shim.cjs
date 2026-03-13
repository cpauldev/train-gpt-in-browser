"use strict";

let Long = null;

try {
  Long = require("long");
} catch {
  Long = null;
}

function hasContent(value) {
  return Boolean(
    value && (typeof value.length === "number" ? value.length > 0 : Object.keys(value).length > 0),
  );
}

function getBufferModule() {
  const bufferConstructor =
    typeof globalThis === "object" && "Buffer" in globalThis ? globalThis.Buffer : null;

  return typeof bufferConstructor === "function" ? { Buffer: bufferConstructor } : null;
}

function getLongModule() {
  const globalLong =
    typeof globalThis === "object" ? (globalThis.dcodeIO?.Long ?? globalThis.Long ?? null) : null;

  return Long ?? globalLong;
}

function inquire(moduleName) {
  let candidate = null;

  switch (moduleName) {
    case "buffer":
      candidate = getBufferModule();
      break;
    case "long":
      candidate = getLongModule();
      break;
    default:
      candidate = null;
      break;
  }

  return hasContent(candidate) ? candidate : null;
}

module.exports = inquire;
