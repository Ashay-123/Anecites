import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import "./ui/theme.css";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
