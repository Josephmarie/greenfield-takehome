import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The app (src/App.jsx, copied from greenfield-app.jsx) runs a simulated call
// lifecycle by default (LIVE=false), so no backend is required to demo it.
// To run against the real services, set LIVE=true + API_BASE in App.jsx.
export default defineConfig({
  plugins: [react()],
});
