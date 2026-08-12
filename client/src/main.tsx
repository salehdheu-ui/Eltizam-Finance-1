import { createRoot } from "react-dom/client";
import App from "./App";
import { registerServiceWorker } from "./lib/pwa";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Registered after the app is handed to React so the worker never competes with
// the first render for the network.
if (import.meta.env.PROD) {
  window.addEventListener("load", () => { void registerServiceWorker(); });
}
