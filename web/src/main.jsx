import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

// Two application roots, chosen by URL.
//
// /kiosk is not a page of the marketing app — it is a separate root, mounted
// deliberately OUTSIDE React.StrictMode. StrictMode double-invokes effects in
// dev, and the kiosk's effects acquire a microphone, create an AudioContext
// and start a Retell call; doing each of those twice is a real bug, not a
// dev-only annoyance. Keeping the roots separate also means "/" never
// downloads three.js.
const root = createRoot(document.getElementById("root"));
const isKiosk = window.location.pathname.replace(/\/+$/, "") === "/kiosk";

if (isKiosk) {
  // Start the avatar download before React has even mounted.
  const preload = document.createElement("link");
  preload.rel = "preload";
  preload.as = "fetch";
  preload.crossOrigin = "anonymous";
  preload.href = "/avatar/facecap.glb"; // keep in sync with kiosk/scene/Avatar.jsx MODEL_URL
  document.head.appendChild(preload);

  import("./kiosk/KioskApp.jsx").then(({ default: KioskApp }) => {
    root.render(<KioskApp />);
  });
} else {
  import("./App.jsx").then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
}
