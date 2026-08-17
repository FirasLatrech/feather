import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./lib/theme";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
