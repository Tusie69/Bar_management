// Pair screenshots by filename without image dependencies. --out is a directory containing index.html and comparison.json.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { args } from "./redesign-visual.mjs"

const options = args("e2e/.artifacts/redesign-comparison")
assert(
  options.before && options.after,
  "Usage: node e2e/redesign-compare.mjs --before <visual-dir> --after <visual-dir> --out <dir>",
)
const out = path.resolve(options.out)
await fs.mkdir(out, { recursive: true })
const escape = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const href = (file) => {
  const relative = path.relative(out, file)
  return path.isAbsolute(relative)
    ? pathToFileURL(file).href
    : relative.split(path.sep).map(encodeURIComponent).join("/")
}

async function shots(dir) {
  const result = new Map()
  // A missing AFTER directory intentionally creates an honest BEFORE-only contact sheet.
  const files = await fs.readdir(dir).catch((error) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  for (const file of files.filter((f) => f.endsWith(".png") && !f.includes("__FAILED"))) {
    if (options.only && !file.startsWith(`${options.only}__`)) continue
    const filename = path.resolve(dir, file)
    const metrics = await fs.readFile(filename.replace(/\.png$/, ".json"), "utf8").then(JSON.parse)
    result.set(file, { filename, metrics })
  }
  return result
}

function counts(shot) {
  if (!shot) return null
  const m = shot.metrics
  return {
    pageOverflow: Number(m.pageOverflow),
    overflowPx: Math.max(0, m.scrollWidth - m.clientWidth),
    clippedText: m.clippedText.length,
    smallTargets: m.smallTargets.length,
    textOverlaps: m.textOverlaps.length,
    consoleErrors: m.consoleErrors.length,
  }
}
const [before, after] = await Promise.all([shots(options.before), shots(options.after)])
const names = [...new Set([...before.keys(), ...after.keys()])].sort()
assert(names.length, "No screenshots found")
const rows = names.map((name) => {
  const b = before.get(name),
    a = after.get(name),
    previous = counts(b),
    next = counts(a)
  const delta =
    previous && next ? Object.fromEntries(Object.keys(previous).map((k) => [k, next[k] - previous[k]])) : null
  return {
    name,
    before: b?.filename ?? null,
    after: a?.filename ?? null,
    previous,
    next,
    delta,
    viewportBefore: b?.metrics.viewport ?? null,
    viewportAfter: a?.metrics.viewport ?? null,
  }
})
assert.equal(rows.length, names.length)
const summary = {
  paired: rows.filter((r) => r.before && r.after).length,
  beforeOnly: rows.filter((r) => r.before && !r.after).length,
  afterOnly: rows.filter((r) => !r.before && r.after).length,
}
await fs.writeFile(path.join(out, "comparison.json"), JSON.stringify({ options, summary, rows }, null, 2))
const figure = (file, label) =>
  `<figure><figcaption>${label}</figcaption>${file ? `<a href="${escape(href(file))}"><img loading="lazy" src="${escape(href(file))}" alt="${label}"></a>` : `<p class="missing">${label} not captured</p>`}</figure>`
const table = (row) =>
  `<table><tr><th>Metric</th><th>BEFORE</th><th>AFTER</th><th>Delta</th></tr>${Object.keys(row.previous ?? row.next)
    .map(
      (k) =>
        `<tr><td>${escape(k)}</td><td>${row.previous?.[k] ?? "-"}</td><td>${row.next?.[k] ?? "-"}</td><td class="${row.delta?.[k] > 0 ? "worse" : ""}">${row.delta?.[k] ?? "-"}</td></tr>`,
    )
    .join("")}</table>`
await fs.writeFile(
  path.join(out, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redesign BEFORE / AFTER</title><style>body{font:14px system-ui;margin:24px;background:#f4f4f4;color:#171717}header{position:sticky;top:0;background:#f4f4f4;padding:8px;z-index:1}article{background:white;padding:16px;margin:20px 0;border:1px solid #ddd}h2{overflow-wrap:anywhere;font-size:17px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}figcaption{font-weight:700;margin:8px 0}img{width:100%;height:auto;border:1px solid #ddd}table{border-collapse:collapse;margin:12px 0}td,th{padding:5px 12px;border:1px solid #ddd;text-align:left}.worse{background:#ffdddd}.missing{padding:30px;border:2px dashed #888}input{min-height:44px;width:min(480px,90%)}[hidden]{display:none}</style><header><h1>Redesign BEFORE / AFTER</h1><p>${summary.paired} pairs; ${summary.beforeOnly} BEFORE only; ${summary.afterOnly} AFTER only. Negative metric deltas indicate fewer findings. Heuristics require visual review.</p><label>Filter filenames <input id="filter" placeholder="e.g. admin-visits__default__390"></label></header>${rows.map((r) => `<article data-name="${escape(r.name)}"><h2>${escape(r.name)}</h2>${table(r)}<p>Actual captured viewport: BEFORE ${escape(JSON.stringify(r.viewportBefore))}; AFTER ${escape(JSON.stringify(r.viewportAfter))}</p><div class="pair">${figure(r.before, "BEFORE")}${figure(r.after, "AFTER")}</div></article>`).join("")}<script>document.querySelector('#filter').addEventListener('input',event=>{for(const row of document.querySelectorAll('article'))row.hidden=!row.dataset.name.includes(event.target.value.trim())})</script></html>`,
)
console.log(JSON.stringify({ ...summary, output: path.join(out, "index.html") }))
