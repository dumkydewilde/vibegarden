#!/usr/bin/env node
/**
 * Build a self-contained HTML report from a benchmark-models.mjs results file.
 *
 * Usage:
 *   node scripts/build-model-report.mjs [path/to/results.json]
 *
 * Defaults to the newest file in scripts/benchmark-results/ and writes
 * docs/benchmarks/model-comparison.html. Fetches current pricing from
 * OpenRouter for the pricing table.
 */

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const resultsDir = join(root, "scripts", "benchmark-results");
const inputPath =
  process.argv[2] ??
  join(
    resultsDir,
    readdirSync(resultsDir)
      .filter((f) => f.startsWith("results-") && f.endsWith(".json"))
      .sort()
      .at(-1),
  );

const run = JSON.parse(readFileSync(inputPath, "utf8"));
console.log(`Input: ${inputPath}`);

// ---------- pricing from OpenRouter ----------

const pricing = {};
try {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  const { data } = await res.json();
  for (const m of data) {
    if (run.models.includes(m.id)) {
      pricing[m.id] = {
        prompt_per_m: Number(m.pricing.prompt) * 1e6,
        completion_per_m: Number(m.pricing.completion) * 1e6,
        context: m.context_length,
      };
    }
  }
} catch (e) {
  console.warn("Could not fetch pricing:", e.message);
}

// ---------- summarize ----------

const median = (xs) => {
  const s = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const shortLabel = (id) =>
  ({
    "moonshotai/kimi-k2.6": "Kimi K2.6",
    "minimax/minimax-m3": "MiniMax M3",
    "deepseek/deepseek-v4-flash": "DeepSeek V4 Flash",
    "deepseek/deepseek-v4-pro": "DeepSeek V4 Pro",
    "qwen/qwen3.7-plus": "Qwen3.7 Plus",
    "google/gemma-4-26b-a4b-it:free": "Gemma 4 26B (free)",
  })[id] ?? id;

const summary = run.models.map((model) => {
  const trials = run.results.filter((r) => r.model === model && !r.error);
  const failures = run.results.filter((r) => r.model === model && r.error);
  const byScenario = {};
  for (const s of run.scenarios) {
    const st = trials.filter((r) => r.scenario === s.id);
    byScenario[s.id] = {
      ttft_ms: median(st.map((r) => r.ttft_ms)),
      total_ms: median(st.map((r) => r.total_ms)),
      cost_usd: median(st.map((r) => r.cost_usd)),
      throughput_tps: median(st.map((r) => r.throughput_tps)),
      tool_calls: st.map((r) => r.tool_calls?.map((c) => c.name) ?? []),
    };
  }
  const grounding = trials.filter((r) => r.scenario === "grounding");
  const groundingCalled = grounding.filter((r) => r.tool_calls?.some((c) => c.name === "read_article"));
  const groundingCorrect = grounding.filter((r) =>
    r.tool_calls?.some(
      (c) => c.name === "read_article" && (c.arguments || "").includes("tokens-embeddings-latent-space"),
    ),
  );
  return {
    model,
    label: shortLabel(model),
    isDefault: model === "moonshotai/kimi-k2.6",
    pricing: pricing[model] ?? null,
    trials: trials.length,
    failures: failures.length,
    ttft_ms: median(trials.map((r) => r.ttft_ms)),
    total_ms: median(trials.map((r) => r.total_ms)),
    cost_usd: median(trials.map((r) => r.cost_usd)),
    throughput_tps: median(trials.map((r) => r.throughput_tps)),
    tokens_out: median(trials.map((r) => r.tokens_out)),
    grounding_tool_rate: grounding.length ? groundingCalled.length / grounding.length : null,
    grounding_correct_rate: grounding.length ? groundingCorrect.length / grounding.length : null,
    byScenario,
  };
});

// Sample answers: first trial per scenario per model.
const samples = run.models.map((model) => ({
  model,
  label: shortLabel(model),
  answers: run.scenarios.map((s) => {
    const r = run.results.find((x) => x.model === model && x.scenario === s.id && !x.error);
    return { scenario: s.label, tools: r?.tool_calls?.map((c) => c.name) ?? [], answer: r?.answer ?? "(failed)" };
  }),
}));

const payload = {
  ran_at: run.ran_at,
  trials: run.trials,
  scenarios: run.scenarios,
  summary,
  samples,
};

// ---------- HTML ----------

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gardener model comparison</title>
<style>
  .viz-root {
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --text-muted: #898781;
    --grid: #e1e0d9;
    --baseline: #c3c2b7;
    --series-1: #2a78d6;
    --emphasis-gray: #c3c2b7;
    --good: #0ca30c;
    --border: rgba(11,11,11,0.10);
  }
  @media (prefers-color-scheme: dark) {
    .viz-root {
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #898781;
      --grid: #2c2c2a;
      --baseline: #383835;
      --series-1: #3987e5;
      --emphasis-gray: #52514e;
      --good: #0ca30c;
      --border: rgba(255,255,255,0.10);
    }
  }
  * { box-sizing: border-box; }
  body.viz-root {
    margin: 0; padding: 32px 24px 64px;
    background: var(--page); color: var(--text-primary);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 650; margin: 0 0 4px; }
  h2 { font-size: 17px; font-weight: 600; margin: 40px 0 4px; }
  .sub { color: var(--text-secondary); margin: 0 0 8px; }
  .note { color: var(--text-muted); font-size: 13px; margin: 4px 0 12px; }
  .card {
    background: var(--surface-1); border: 1px solid var(--border);
    border-radius: 10px; padding: 20px; margin-top: 12px;
  }
  svg text { font: 12px system-ui, -apple-system, "Segoe UI", sans-serif; }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--grid); }
  th { color: var(--text-muted); font-weight: 500; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .tag {
    display: inline-block; font-size: 11px; color: var(--text-muted);
    border: 1px solid var(--grid); border-radius: 999px; padding: 0 7px; margin-left: 6px;
  }
  #tooltip {
    position: fixed; pointer-events: none; z-index: 10; display: none;
    background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,.12); padding: 8px 12px; font-size: 12.5px;
    color: var(--text-primary); max-width: 280px;
  }
  #tooltip .t-title { font-weight: 600; margin-bottom: 2px; }
  #tooltip .t-row { display: flex; justify-content: space-between; gap: 16px; color: var(--text-secondary); }
  #tooltip .t-row b { color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
  details { margin-top: 10px; }
  summary { cursor: pointer; color: var(--text-secondary); }
  .answer { white-space: pre-wrap; font-size: 13px; color: var(--text-secondary);
    border-left: 2px solid var(--grid); padding: 4px 0 4px 12px; margin: 8px 0 16px; }
  .ok { color: var(--good); }
  .bad { color: #d03b3b; }
</style>
</head>
<body class="viz-root">
<main>
  <h1>Gardener model comparison</h1>
  <p class="sub">Production-shaped benchmark: real system prompt, real tool definitions, the same
  tool-round loop as the chat route, against OpenRouter.</p>
  <p class="note" id="meta"></p>

  <h2>Price list (OpenRouter, per million tokens)</h2>
  <div class="card"><table id="pricing"></table></div>

  <h2>Time to first visible token</h2>
  <p class="note">Median across all scenarios and trials; what a person waits before anything appears. Lower is better. Hover a bar for the per-scenario split.</p>
  <div class="card" id="chart-ttft"></div>

  <h2>Total answer time</h2>
  <p class="note">Median wall-clock time until the full answer (including tool rounds) finished. Lower is better.</p>
  <div class="card" id="chart-total"></div>

  <h2>Cost per answer</h2>
  <p class="note">Median metered cost of one full answer (all rounds), from OpenRouter's own accounting.</p>
  <div class="card" id="chart-cost"></div>

  <h2>Generation speed</h2>
  <p class="note">Median completion tokens per second, as metered by OpenRouter. Higher is better.</p>
  <div class="card" id="chart-tps"></div>

  <h2>Tool-calling reliability</h2>
  <p class="note">The "grounding" scenario should trigger read_article with the embeddings article slug.</p>
  <div class="card"><table id="tools"></table></div>

  <h2>All numbers (table view)</h2>
  <div class="card" style="overflow-x:auto"><table id="alltable"></table></div>

  <h2>Sample answers (judge quality yourself)</h2>
  <p class="note">First trial per scenario, verbatim. Speed and price are measurable; whether the voice fits the Gardener is a human call.</p>
  <div id="samples"></div>
</main>
<div id="tooltip"></div>
<script>
const DATA = ${JSON.stringify(payload)};

const fmtMs = (v) => v == null ? "–" : (v >= 10000 ? (v/1000).toFixed(1) + "s" : (v/1000).toFixed(2) + "s");
const fmtCost = (v) => v == null ? "–" : (v === 0 ? "$0" : "$" + v.toFixed(4));
const fmtTps = (v) => v == null ? "–" : v.toFixed(0) + " tok/s";
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

document.getElementById("meta").textContent =
  "Ran " + new Date(DATA.ran_at).toLocaleString() + " · " + DATA.scenarios.length +
  " scenarios × " + DATA.trials + " trials per model · medians shown · * = current default";

// ----- pricing table -----
{
  const rows = DATA.summary.map((m) => {
    const p = m.pricing;
    return "<tr><td>" + esc(m.label) + (m.isDefault ? '<span class="tag">current default</span>' : "") +
      "</td><td class='num'>" + (p ? "$" + p.prompt_per_m.toFixed(2) : "–") +
      "</td><td class='num'>" + (p ? "$" + p.completion_per_m.toFixed(2) : "–") +
      "</td><td class='num'>" + (p ? Math.round(p.context / 1024) + "k" : "–") + "</td></tr>";
  }).join("");
  document.getElementById("pricing").innerHTML =
    "<tr><th>Model</th><th class='num'>Input /M</th><th class='num'>Output /M</th><th class='num'>Context</th></tr>" + rows;
}

// ----- bar chart builder (horizontal, single series, value at tip) -----
const tooltip = document.getElementById("tooltip");
function showTip(evt, title, rows) {
  tooltip.innerHTML = '<div class="t-title">' + esc(title) + "</div>" +
    rows.map((r) => '<div class="t-row"><span>' + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>").join("");
  tooltip.style.display = "block";
  const pad = 14;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  const rect = tooltip.getBoundingClientRect();
  if (x + rect.width > innerWidth - 8) x = evt.clientX - rect.width - pad;
  if (y + rect.height > innerHeight - 8) y = evt.clientY - rect.height - pad;
  tooltip.style.left = x + "px"; tooltip.style.top = y + "px";
}
const hideTip = () => (tooltip.style.display = "none");

function barChart(el, items, fmt, perScenario) {
  // items: [{label, value, isDefault, model}] sorted by value asc (best first)
  const W = 820, rowH = 34, mL = 150, mR = 90, mT = 6, mB = 22;
  const H = mT + items.length * rowH + mB;
  const vals = items.map((i) => i.value).filter((v) => v != null);
  const rawMax = Math.max(...vals) || 1;
  // round the axis max up to a clean 1/2/2.5/5 x 10^k so ticks land on round numbers
  const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const max = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((m) => m >= rawMax) ?? rawMax;
  const x = (v) => mL + (v / max) * (W - mL - mR);
  let s = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" role="img">';
  // gridlines: 4 clean ticks
  const ticks = 4;
  for (let t = 1; t <= ticks; t++) {
    const v = (max * t) / ticks;
    s += '<line x1="' + x(v) + '" y1="' + mT + '" x2="' + x(v) + '" y2="' + (H - mB) +
      '" stroke="var(--grid)" stroke-width="1"/>';
    s += '<text x="' + x(v) + '" y="' + (H - 6) + '" text-anchor="middle" fill="var(--text-muted)">' +
      fmt(v).replace("$0.", "$.") + "</text>";
  }
  s += '<line x1="' + mL + '" y1="' + mT + '" x2="' + mL + '" y2="' + (H - mB) +
    '" stroke="var(--baseline)" stroke-width="1"/>';
  items.forEach((it, i) => {
    const y = mT + i * rowH + (rowH - 20) / 2;
    s += '<text x="' + (mL - 8) + '" y="' + (y + 14) + '" text-anchor="end" fill="var(--text-secondary)">' +
      esc(it.label) + "</text>";
    if (it.value == null) {
      s += '<text x="' + (mL + 8) + '" y="' + (y + 14) + '" fill="var(--text-muted)">no data</text>';
      return;
    }
    const w = Math.max(x(it.value) - mL, 2);
    // square at baseline, 4px rounded data-end: rect with right-side rounding via path
    const r = Math.min(4, w);
    s += '<path class="bar" data-i="' + i + '" d="M' + mL + " " + y + " h" + (w - r) +
      " a" + r + " " + r + " 0 0 1 " + r + " " + r + " v" + (20 - 2 * r) +
      " a" + r + " " + r + " 0 0 1 -" + r + " " + r + " h-" + (w - r) +
      ' Z" fill="var(--series-1)"/>';
    s += '<text x="' + (x(it.value) + 6) + '" y="' + (y + 14) + '" fill="var(--text-primary)" font-weight="600">' +
      fmt(it.value) + "</text>";
  });
  s += "</svg>";
  el.innerHTML = s;
  el.querySelectorAll(".bar").forEach((bar) => {
    const it = items[Number(bar.dataset.i)];
    const move = (e) => showTip(e, it.label, perScenario(it));
    bar.addEventListener("mousemove", move);
    bar.addEventListener("mouseleave", hideTip);
  });
}

const byVal = (key, dir = 1) =>
  DATA.summary
    .map((m) => ({ label: m.label + (m.isDefault ? " *" : ""), value: m[key], byScenario: m.byScenario }))
    .sort((a, b) => (a.value == null) - (b.value == null) || dir * (a.value - b.value));

const scenarioRows = (key, fmt) => (it) =>
  DATA.scenarios.map((s) => [s.label, fmt(it.byScenario?.[s.id]?.[key])]);

barChart(document.getElementById("chart-ttft"), byVal("ttft_ms"), fmtMs, scenarioRows("ttft_ms", fmtMs));
barChart(document.getElementById("chart-total"), byVal("total_ms"), fmtMs, scenarioRows("total_ms", fmtMs));
barChart(document.getElementById("chart-cost"), byVal("cost_usd"), fmtCost, scenarioRows("cost_usd", fmtCost));
barChart(document.getElementById("chart-tps"), byVal("throughput_tps", -1), fmtTps, scenarioRows("throughput_tps", fmtTps));

// ----- tool reliability table -----
{
  const rows = DATA.summary.map((m) => {
    const rate = (v) => v == null ? "–" : Math.round(v * 100) + "%";
    const cls = (v) => v == null ? "" : v >= 1 ? "ok" : v > 0 ? "" : "bad";
    return "<tr><td>" + esc(m.label) + (m.isDefault ? '<span class="tag">current default</span>' : "") +
      "</td><td class='num " + cls(m.grounding_tool_rate) + "'>" + rate(m.grounding_tool_rate) +
      "</td><td class='num " + cls(m.grounding_correct_rate) + "'>" + rate(m.grounding_correct_rate) +
      "</td><td class='num'>" + (m.failures || 0) + "</td></tr>";
  }).join("");
  document.getElementById("tools").innerHTML =
    "<tr><th>Model</th><th class='num'>Called read_article</th><th class='num'>Correct article</th><th class='num'>Failed trials</th></tr>" + rows;
}

// ----- full table -----
{
  let head = "<tr><th>Model</th>";
  for (const s of DATA.scenarios) head += "<th class='num' colspan='3'>" + esc(s.label) + "</th>";
  head += "</tr><tr><th></th>" + DATA.scenarios.map(() =>
    "<th class='num'>TTFT</th><th class='num'>Total</th><th class='num'>Cost</th>").join("") + "</tr>";
  const rows = DATA.summary.map((m) =>
    "<tr><td>" + esc(m.label) + "</td>" + DATA.scenarios.map((s) => {
      const b = m.byScenario[s.id] ?? {};
      return "<td class='num'>" + fmtMs(b.ttft_ms) + "</td><td class='num'>" + fmtMs(b.total_ms) +
        "</td><td class='num'>" + fmtCost(b.cost_usd) + "</td>";
    }).join("") + "</tr>").join("");
  document.getElementById("alltable").innerHTML = head + rows;
}

// ----- samples -----
{
  const el = document.getElementById("samples");
  el.innerHTML = DATA.samples.map((m) =>
    "<details><summary><b>" + esc(m.label) + "</b></summary>" +
    m.answers.map((a) =>
      "<p class='note'>" + esc(a.scenario) + (a.tools.length ? " · tools: " + esc(a.tools.join(", ")) : " · no tools") + "</p>" +
      "<div class='answer'>" + esc(a.answer) + "</div>").join("") +
    "</details>").join("");
}
</script>
</body>
</html>
`;

const outDir = join(root, "docs", "benchmarks");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "model-comparison.html");
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
