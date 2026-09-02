// Runs every *.test.mjs under src/. Plain node, no test framework: these suites
// are pure functions over pure data, and the whole point is that they run in
// milliseconds anywhere with no browser, no audio device and no network.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function find(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) find(p, out);
    else if (name.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

const files = find("src").sort();
let failed = 0;
for (const f of files) {
  try {
    await import(pathToFileURL(f).href);
  } catch (e) {
    failed++;
    console.error(`\nFAIL ${f}\n${e.message}\n`);
  }
}
console.log(failed ? `\n${failed} suite(s) failed` : `\n${files.length} suites passed`);
process.exit(failed ? 1 : 0);
