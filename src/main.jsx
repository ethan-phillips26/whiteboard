import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { registerStreamWorker } from "./browser/stream.js";
import "./styles.css";

// The worker that lets a video play. It answers nothing but this app's own
// stream URLs, so installing it changes how nothing else on the site is served;
// it goes in on load because a worker only serves pages it claimed first.
registerStreamWorker();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
