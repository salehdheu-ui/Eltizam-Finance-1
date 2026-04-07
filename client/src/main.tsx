import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (typeof document !== "undefined") {
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
  document.body.dir = "rtl";
}

createRoot(document.getElementById("root")!).render(<App />);
