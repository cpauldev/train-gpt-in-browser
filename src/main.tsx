import ReactDOM from "react-dom/client";

import App from "./App";
import { AnchoredToastProvider, ToastProvider } from "./components/ui/toast";
import "./index.css";
import glowBg from "@/assets/glow.webp";
import { initializeAppTheme, ThemeProvider } from "./lib/app-theme";
import { registerServiceWorker } from "./lib/service-worker";
import { migrateLocalPreferences } from "./lib/storage-migration";
import { STORAGE_DB_NAME } from "./lib/trainer-defaults";

// Preload the hero background image before React mounts to avoid a white flash.
const preloadLink = document.createElement("link");
preloadLink.rel = "preload";
preloadLink.as = "image";
preloadLink.href = glowBg;
document.head.appendChild(preloadLink);

migrateLocalPreferences(STORAGE_DB_NAME);
initializeAppTheme();

const rootElement = document.getElementById("root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('Root element "#root" was not found.');
}

registerServiceWorker();

ReactDOM.createRoot(rootElement).render(
  <ToastProvider position="bottom-center">
    <AnchoredToastProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </AnchoredToastProvider>
  </ToastProvider>,
);
