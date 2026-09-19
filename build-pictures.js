/* Runs on every Vercel deploy (see vercel.json).
   1. Copies the site into ./public (Vercel serves that folder).
   2. Looks in pictures/saturday and pictures/wednesday and writes
      public/pictures/manifest.json, which the Run Pictures page reads.
   Upload photos to those folders on GitHub, nothing else to edit. */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SRC = __dirname;
const OUT = path.join(SRC, "public");
const SKIP = new Set([".git", ".github", ".vercel", "node_modules", "public"]);
const RUNS = ["saturday", "wednesday"];
const IMG = /\.(jpe?g|png|webp)$/i;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (from === SRC && SKIP.has(entry.name)) continue;
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}

function lastUpload(dir) {
  try {
    return execSync(`git log -1 --format=%cI -- "${dir}"`, { cwd: SRC, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim() || null;
  } catch (e) { return null; }
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(SRC, OUT);

const manifest = { generated: new Date().toISOString(), runs: {} };
for (const run of RUNS) {
  let files = [];
  try { files = fs.readdirSync(path.join(SRC, "pictures", run)).filter((f) => IMG.test(f) && !f.startsWith(".")); } catch (e) {}
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  manifest.runs[run] = {
    date: files.length ? lastUpload(path.join("pictures", run)) : null,
    photos: files.map((f) => ({ name: f, src: `/pictures/${run}/${encodeURIComponent(f)}` })),
  };
  console.log(`[run pictures] ${run}: ${files.length} photos`);
}
fs.mkdirSync(path.join(OUT, "pictures"), { recursive: true });
fs.writeFileSync(path.join(OUT, "pictures", "manifest.json"), JSON.stringify(manifest));
console.log("[run pictures] site copied to public/");
