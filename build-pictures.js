/* Runs on every Vercel deploy (see vercel.json).
   Looks in pictures/saturday and pictures/wednesday and writes
   pictures/manifest.json, which the Run Pictures page reads.
   Upload photos to those folders on GitHub, nothing else to edit. */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "pictures");
const RUNS = ["saturday", "wednesday"];
const IMG = /\.(jpe?g|png|webp)$/i;

function lastUpload(dir) {
  try {
    const out = execSync(`git log -1 --format=%cI -- "${dir}"`, { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    return out || null;
  } catch (e) { return null; }
}

const manifest = { generated: new Date().toISOString(), runs: {} };
for (const run of RUNS) {
  const dir = path.join(ROOT, run);
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => IMG.test(f) && !f.startsWith(".")); } catch (e) {}
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  manifest.runs[run] = {
    date: files.length ? lastUpload(path.join("pictures", run)) : null,
    photos: files.map((f) => ({ name: f, src: `/pictures/${run}/${encodeURIComponent(f)}` })),
  };
  console.log(`[run pictures] ${run}: ${files.length} photos`);
}
fs.mkdirSync(ROOT, { recursive: true });
fs.writeFileSync(path.join(ROOT, "manifest.json"), JSON.stringify(manifest));
