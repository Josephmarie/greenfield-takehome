import { useEffect, useState } from "react";

// One design unit for the whole kiosk.
//
// Every dimension in the kiosk is expressed as a multiple of `u`, so the same
// layout is correct at 1080p, at 4K, and rotated into portrait without a
// single media query. Landscape is a 192x108 grid (u = 10px at 1920x1080);
// portrait swaps to 108x192.
export function useViewport() {
  const read = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = h > w;
    const u = portrait ? Math.min(w / 108, h / 192) : Math.min(w / 192, h / 108);
    return { w, h, portrait, u, aspect: w / h };
  };

  const [vp, setVp] = useState(read);

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVp(read()));
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  return vp;
}
