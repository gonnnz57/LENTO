/* GET /api/runs
   Reads the club calendar (an .ics feed) and returns the next runs as JSON.
   Spond has no public API, so the chain is:
   Spond app  ->  writes events into a Google calendar  ->  that calendar is public
   ->  its .ics address is stored in the RUNS_ICS environment variable in Vercel. */

const MONTHS = 60 * 1000;

function unfold(text) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}
function unescape_(v) {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}
/* 20260117T103000Z  or  20260117T103000  or  20260117 */
function parseStamp(value, params) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  const allDay = !m[4];
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)), allDay, floating: false };
  /* no Z: treat as Oslo wall time */
  const guess = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  const offset = osloOffset(guess);
  return { date: new Date(guess.getTime() - offset), allDay, floating: true };
}
function osloOffset(d) {
  const tz = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Oslo", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
  const asUTC = Date.UTC(+tz.year, +tz.month - 1, +tz.day, +tz.hour, +tz.minute, +tz.second);
  return asUTC - d.getTime();
}

function events(ics) {
  const lines = unfold(ics);
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const left = line.slice(0, i), value = line.slice(i + 1);
    const name = left.split(";")[0].toUpperCase();
    if (name === "DTSTART") cur.start = parseStamp(value, left);
    else if (name === "DTEND") cur.end = parseStamp(value, left);
    else if (name === "SUMMARY") cur.title = unescape_(value);
    else if (name === "LOCATION") cur.place = unescape_(value);
    else if (name === "STATUS") cur.status = value.trim().toUpperCase();
    else if (name === "RRULE") cur.rrule = value.trim().toUpperCase();
    else if (name === "DESCRIPTION" || name === "URL" || name === "X-ALT-DESC") cur.text = (cur.text || "") + " " + unescape_(value);
  }
  return out;
}

/* weekly repeats get expanded for the next three months */
function expand(ev, from, until) {
  const list = [];
  if (!ev.start) return list;
  if (!ev.rrule || !/FREQ=WEEKLY/.test(ev.rrule)) {
    if (ev.start.date >= from && ev.start.date <= until) list.push(ev.start.date);
    return list;
  }
  const every = (ev.rrule.match(/INTERVAL=(\d+)/) || [, "1"])[1] * 1;
  const endsAt = (ev.rrule.match(/UNTIL=(\d{8}T?\d*Z?)/) || [])[1];
  const hardStop = endsAt ? parseStamp(endsAt.replace("T", "T"))?.date : null;
  let d = new Date(ev.start.date);
  for (let i = 0; i < 40; i++) {
    if (hardStop && d > hardStop) break;
    if (d > until) break;
    if (d >= from) list.push(new Date(d));
    d = new Date(d.getTime() + every * 7 * 24 * 3600 * 1000);
  }
  return list;
}

module.exports = async (req, res) => {
  const url = process.env.RUNS_ICS;
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
  if (!url) { res.status(200).json({ runs: [], note: "no calendar connected" }); return; }
  try {
    /* never let a slow calendar hang the page */
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    let r;
    try {
      r = await fetch(url.replace(/^webcal:/, "https:"), { signal: ctrl.signal, redirect: "follow" });
    } finally { clearTimeout(timer); }
    if (!r.ok) throw new Error("calendar responded " + r.status);
    const ics = await r.text();
    if (!/BEGIN:VCALENDAR/i.test(ics)) throw new Error("that link is not a calendar feed");
    const now = new Date(Date.now() - 2 * 3600 * 1000);          /* keep a run visible while it is on */
    const until = new Date(Date.now() + 90 * 24 * 3600 * 1000);
    const runs = [];
    for (const ev of events(ics)) {
      if (ev.status === "CANCELLED") continue;
      for (const when of expand(ev, now, until)) {
        const link = (ev.text || "").match(/https?:\/\/[^\s<>"']*spond[^\s<>"']*/i);
        runs.push({
          title: ev.title || "Lento run",
          place: ev.place || "",
          link: link ? link[0] : "",
          start: when.toISOString(),
          allDay: !!(ev.start && ev.start.allDay),
        });
      }
    }
    runs.sort((a, b) => a.start.localeCompare(b.start));
    res.status(200).json({ runs: runs.slice(0, 6), updated: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ runs: [], error: e.name === "AbortError" ? "calendar timed out" : e.message });
  }
};
