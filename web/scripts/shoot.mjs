// Render harness for the kiosk.
//
// Chrome's --screenshot flag needs --virtual-time-budget to wait for anything
// async, and virtual time FREEZES requestAnimationFrame once the budget is
// spent - so a continuously animating WebGL scene either never finishes
// loading or is captured with its frame loop already stopped. Driving a real
// browser over CDP instead gives real rAF, a real GPU, and the console.
//
// Usage:
//   node scripts/shoot.mjs <url> <out.png> [--w 1920] [--h 1080] [--wait 6000]
//                          [--stats] [--eval "expr"]
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const bool = (name) => args.includes(`--${name}`);

const url = args[0];
const out = args[1];
if (!url || !out) {
  console.error("usage: node scripts/shoot.mjs <url> <out.png> [--w] [--h] [--wait] [--stats] [--eval expr]");
  process.exit(2);
}

const width = Number(flag("w", 1920));
const height = Number(flag("h", 1080));
const wait = Number(flag("wait", 6000));
const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!executablePath) { console.error("Chrome not found"); process.exit(2); }

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    `--window-size=${width},${height}`,
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--autoplay-policy=no-user-gesture-required",
    // Headless has no real GPU; SwiftShader gives a correct (slow) raster so
    // the scene can be validated for content. Frame timings from this harness
    // are therefore NOT a performance measurement - use a real display for that.
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--mute-audio",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, wait));

// Optionally start a conversation, then capture a filmstrip so motion and
// lipsync can be reviewed as a sequence rather than a single lucky frame.
if (bool("click")) {
  await page.mouse.click(Math.round(width / 2), Math.round(height * 0.75));
}

const shots = Number(flag("shots", 0));
if (shots > 0) {
  const every = Number(flag("every", 900));
  const base = out.replace(/\.png$/, "");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  for (let i = 0; i < shots; i++) {
    await new Promise((r) => setTimeout(r, every));
    const frame = `${base}-${String(i).padStart(2, "0")}.png`;
    await page.screenshot({ path: frame });
    const st = await page.evaluate(() => {
      const k = window.__kiosk;
      if (!k) return null;
      const s = k.signals;
      return { state: s.state, amp: +s.amp.toFixed(3), jaw: +s.mouth.jawOpen.toFixed(3), talking: s.agentTalking };
    });
    console.log(`frame ${i}`, JSON.stringify(st));
  }
}

if (bool("stats")) {
  const stats = await page.evaluate(() => window.__kioskStats?.() ?? null);
  console.log("stats:", JSON.stringify(stats, null, 2));
}

const evalExpr = flag("eval", null);
if (evalExpr) {
  const value = await page.evaluate(evalExpr);
  console.log("eval:", JSON.stringify(value, null, 2));
}

fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
await browser.close();

const noisy = logs.filter((l) => !/Import Map|preloaded using link preload|DevTools/.test(l));
if (noisy.length) { console.log("--- console ---"); noisy.forEach((l) => console.log(l)); }
console.log("wrote", out);
