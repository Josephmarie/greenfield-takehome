// Acceptance test: loading "/" must never download the 3D renderer.
//
// An earlier version of this walked static import strings out of the built
// chunks and failed as soon as the kiosk existed - of course three.js is
// *reachable* from the entry, that is what a dynamic import looks like in the
// static graph. Reachability is the wrong question. The question is what the
// browser actually fetches, so this drives a real browser and watches the
// network, then does the same on /kiosk to prove the chunk exists and is only
// pulled where it is wanted.
//
//   npm run build && npx vite preview --port 4319 &
//   node scripts/check-bundle.mjs [http://localhost:4319]
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] || "http://localhost:4319";
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((p) => fs.existsSync(p));

if (!CHROME) { console.error("Chrome not found"); process.exit(2); }

const is3D = (u) => /\/(three|r3f)-[A-Za-z0-9_-]+\.js/.test(u);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--mute-audio", "--window-size=1280,800"],
});

async function fetchedOn(path, settleMs) {
  const page = await browser.newPage();
  const urls = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, settleMs));
  await page.close();
  return urls;
}

// "/" gets a generous settle: a late lazy import would still be caught.
const home = await fetchedOn("/", 4000);
const kiosk = await fetchedOn("/kiosk", 7000);
await browser.close();

const leaked = home.filter(is3D);
const loaded = kiosk.filter(is3D);

console.log(`/       requested ${home.length} resources, ${leaked.length} of them 3D`);
console.log(`/kiosk  requested ${kiosk.length} resources, ${loaded.length} of them 3D`);

let failed = false;
if (leaked.length) {
  console.error("FAIL: loading / downloaded the 3D renderer:\n  " + leaked.join("\n  "));
  failed = true;
}
if (!loaded.length) {
  // Guards the opposite mistake: a guard that passes because the kiosk is
  // broken and never loads its renderer at all is worse than no guard.
  console.error("FAIL: /kiosk did not download the 3D renderer - is the kiosk actually working?");
  failed = true;
}
if (!failed) console.log("PASS: the 3D renderer is fetched on /kiosk and never on /");
process.exit(failed ? 1 : 0);
