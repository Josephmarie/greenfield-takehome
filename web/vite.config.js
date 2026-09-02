import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Two entry paths share this build: the marketing/console app at "/" and the
// lobby kiosk at "/kiosk" (see src/main.jsx). Both are dynamically imported,
// and three.js is split into its own chunks, so loading "/" never pays for the
// kiosk's 3D renderer.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Function form, not the object form: the object form emits a named
        // chunk even when nothing imports the package, leaving orphan files
        // in dist/. This only splits modules actually in the graph.
        manualChunks(id) {
          // React must be named explicitly. Without this rollup folds it into
          // the "r3f" chunk (both the entry and the kiosk use it), which makes
          // the ENTRY statically import r3f - and three with it - so "/" pays
          // for the 3D renderer on every page load. scripts/check-bundle.mjs
          // catches exactly this by watching real network traffic.
          // Vite's own dynamic-import helper (__vitePreload). The entry needs
          // it because main.jsx code-splits, and if it is left to rollup it
          // gets folded into whichever chunk happens to be convenient - it
          // landed in "r3f", which dragged three.js onto the marketing page
          // through a one-symbol static import.
          if (id.includes("preload-helper")) return "vite-helper";
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (id.includes("node_modules/three/")) return "three";
          if (id.includes("node_modules/@react-three/")) return "r3f";
        },
      },
    },
  },
});
