// Backend endpoints. Previously hardcoded at the top of App.jsx; lifted out so
// the kiosk shares one source of truth. Values are overridable at build time
// (VITE_API_BASE / VITE_OCR_BASE) but default to the deployed services, so
// existing builds behave exactly as before with no env configured.
const env = (typeof import.meta !== "undefined" && import.meta.env) || {};

export const API_BASE = env.VITE_API_BASE || "https://greenfield-voice-agent.onrender.com";
export const OCR_BASE = env.VITE_OCR_BASE || "https://greenfield-ocr.onrender.com";
