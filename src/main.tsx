import ReactDOM from "react-dom/client";

import App from "./App";
import { AnchoredToastProvider, ToastProvider } from "./components/ui/toast";
import "./index.css";
import glowBg from "@/assets/glow.jpg";
import { initializeAppTheme, ThemeProvider } from "./lib/app-theme";
import { registerServiceWorker } from "./lib/service-worker";

// Preload the hero background image before React mounts to avoid a white flash.
const preloadLink = document.createElement("link");
preloadLink.rel = "preload";
preloadLink.as = "image";
preloadLink.href = glowBg;
document.head.appendChild(preloadLink);

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
