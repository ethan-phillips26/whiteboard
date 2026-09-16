import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { NATIVE } from "./browser/mode.js";
import { registerStreamWorker } from "./browser/stream.js";
import "./styles.css";

// In the app, the page is the whole screen and must not zoom. iOS zooms into any
// input under 16px on focus and leaves the page wider than the screen afterwards.
// The site keeps pinch-zoom: a browser page that refuses it fails anyone who needs it.
if (NATIVE) {
  // For the few rules that only make sense inside the app.
  document.documentElement.classList.add("native");
  document.querySelector('meta[name="viewport"]')?.setAttribute("content",
    "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
}

// The worker that lets a video play. It answers nothing but this app's own
// stream URLs, so installing it changes how nothing else on the site is served;
// it goes in on load because a worker only serves pages it claimed first.
registerStreamWorker();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
