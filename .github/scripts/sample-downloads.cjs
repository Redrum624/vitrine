#!/usr/bin/env node
// sample-downloads.js — sample GitHub release download counts and render an SVG chart.
// Zero dependencies. Node >= 18 (global fetch).
//
// Usage:
//   node sample-downloads.js sample --repo owner/name --data .github/badges/downloads-data.json
//   node sample-downloads.js render --data .github/badges/downloads-data.json --out .github/badges/downloads.svg
//   node sample-downloads.js badges --data .github/badges/downloads-data.json --out-dir .github/badges
//
// `sample` reads GITHUB_TOKEN from the environment if present (raises the API
// rate limit; required for private repos, optional for public ones).
//
// `badges` renders the README's downloads / latest-release badges SELF-HOSTED.
// The README used to hot-link img.shields.io/github/* for these — that route
// depends on shields.io's own GitHub token pool, and when it drains the README
// shows "unable to select next github token from pool" error badges
// (observed 2026-07-23). The data both badges need is already in our sampled
// JSON, so we render them ourselves and shields can never break them again.

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const args = { cmd };
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i] || !rest[i].startsWith("--") || rest[i + 1] === undefined) {
      throw new Error(`bad argument: ${rest[i]}`);
    }
    args[rest[i].slice(2)] = rest[i + 1];
  }
  return args;
}

function loadData(file) {
  if (!fs.existsSync(file)) return { samples: [] };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function sample(args) {
  if (!args.repo || !args.data) throw new Error("sample needs --repo owner/name and --data file.json");
  const headers = { "User-Agent": "download-stats", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const releases = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${args.repo}/releases?per_page=100&page=${page}`,
      { headers }
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${args.repo}: ${(await res.text()).slice(0, 200)}`);
    const batch = await res.json();
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const by_release = {};
  let total = 0;
  for (const rel of releases) {
    const count = (rel.assets || []).reduce((sum, a) => sum + (a.download_count || 0), 0);
    by_release[rel.tag_name] = count;
    total += count;
  }
  const data = loadData(args.data);
  // Newest non-draft, non-prerelease tag — the API returns releases newest-first.
  const latestRel = releases.find((r) => !r.draft && !r.prerelease);
  if (latestRel) data.latest_release = latestRel.tag_name;
  const today = new Date().toISOString().slice(0, 10);
  data.samples = (data.samples || []).filter((s) => s.date !== today); // re-run same day = replace
  data.samples.push({ date: today, total, by_release });
  data.samples.sort((a, b) => a.date.localeCompare(b.date));
  fs.mkdirSync(path.dirname(args.data), { recursive: true });
  fs.writeFileSync(args.data, JSON.stringify(data, null, 2) + "\n");
  console.log(`sampled ${args.repo}: total=${total} releases=${releases.length} samples=${data.samples.length}`);
}

function render(args) {
  if (!args.data || !args.out) throw new Error("render needs --data file.json and --out file.svg");
  const { samples } = loadData(args.data);
  if (!samples || samples.length === 0) throw new Error(`no samples in ${args.data} — run sample first`);
  const W = 800, H = 300, PAD = { top: 28, right: 24, bottom: 40, left: 64 };
  const iw = W - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;
  const max = Math.max(...samples.map((s) => s.total), 1);
  const x = (i) => PAD.left + (samples.length === 1 ? iw / 2 : (i / (samples.length - 1)) * iw);
  const y = (v) => PAD.top + ih - (v / max) * ih;
  const points = samples.map((s, i) => `${x(i).toFixed(1)},${y(s.total).toFixed(1)}`).join(" ");
  const first = samples[0], latest = samples[samples.length - 1];
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const gy = (PAD.top + ih - f * ih).toFixed(1);
      const label = Math.round(max * f).toLocaleString("en-US");
      return (
        `<line x1="${PAD.left}" y1="${gy}" x2="${W - PAD.right}" y2="${gy}" stroke="#8b949e" stroke-opacity="0.25"/>` +
        `<text x="${PAD.left - 8}" y="${gy}" dy="4" text-anchor="end" class="t">${label}</text>`
      );
    })
    .join("\n  ");
  // Transparent background + grey text render legibly on both GitHub themes.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Downloads over time">
  <style>.t{font:12px -apple-system,'Segoe UI',sans-serif;fill:#8b949e}.title{font:600 14px -apple-system,'Segoe UI',sans-serif;fill:#8b949e}</style>
  ${grid}
  <polyline points="${points}" fill="none" stroke="#58a6ff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${x(samples.length - 1).toFixed(1)}" cy="${y(latest.total).toFixed(1)}" r="4" fill="#58a6ff"/>
  <text x="${PAD.left}" y="${H - 12}" class="t">${first.date}</text>
  <text x="${W - PAD.right}" y="${H - 12}" text-anchor="end" class="t">${latest.date}</text>
  <text x="${W - PAD.right}" y="${PAD.top - 8}" text-anchor="end" class="title">Total downloads: ${latest.total.toLocaleString("en-US")}</text>
</svg>
`;
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, svg);
  console.log(`rendered ${args.out} (${samples.length} samples, max=${max})`);
}

// One flat two-segment badge in the shields "for-the-badge" idiom (28px tall,
// bold uppercase, letter-spaced). textLength pins the text to our estimated
// width so font fallback differences can't overflow the box.
function badgeSvg(label, value, color) {
  const H = 28, FS = 11, PADX = 12, LS = 1.5; // height, font-size, x-padding, letter-spacing
  const width = (s) => Math.ceil(s.length * (FS * 0.68 + LS)) + PADX * 2;
  const l = label.toUpperCase(), v = value.toUpperCase();
  const lw = width(l), vw = width(v);
  const text = (str, x, w) =>
    `<text x="${x}" y="18.5" textLength="${w - PADX * 2}" lengthAdjust="spacingAndGlyphs" ` +
    `font-family="Verdana,'DejaVu Sans',sans-serif" font-size="${FS}" font-weight="bold" ` +
    `letter-spacing="${LS}" fill="#fff">${str}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="${H}" role="img" aria-label="${l}: ${v}">
  <rect width="${lw}" height="${H}" fill="#555"/>
  <rect x="${lw}" width="${vw}" height="${H}" fill="${color}"/>
  ${text(l, PADX, lw)}
  ${text(v, lw + PADX, vw)}
</svg>
`;
}

function badges(args) {
  if (!args.data || !args["out-dir"]) throw new Error("badges needs --data file.json and --out-dir dir");
  const data = loadData(args.data);
  const samples = data.samples || [];
  if (samples.length === 0) throw new Error(`no samples in ${args.data} — run sample first`);
  const total = samples[samples.length - 1].total;
  const tag = args.tag || data.latest_release;
  if (!tag) throw new Error("no latest_release in data (re-run sample) and no --tag given");
  fs.mkdirSync(args["out-dir"], { recursive: true });
  const downloads = path.join(args["out-dir"], "downloads-badge.svg");
  const latest = path.join(args["out-dir"], "latest-badge.svg");
  fs.writeFileSync(downloads, badgeSvg("downloads", total.toLocaleString("en-US"), "#1f6feb"));
  fs.writeFileSync(latest, badgeSvg("latest", tag, "#8957e5"));
  console.log(`rendered ${downloads} (${total}) and ${latest} (${tag})`);
}

(async () => {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.cmd === "sample") await sample(args);
    else if (args.cmd === "render") render(args);
    else if (args.cmd === "badges") badges(args);
    else throw new Error(`unknown command "${args.cmd ?? ""}" — use: sample | render | badges`);
  } catch (err) {
    console.error(String((err && err.message) || err));
    process.exit(1);
  }
})();
