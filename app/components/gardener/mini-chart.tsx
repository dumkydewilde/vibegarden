/**
 * A small single-series SVG chart for query results in the chat: line,
 * scatter, or bar. Styled like shadcn's charts: transparent background,
 * no axis lines, only a few dashed horizontal gridlines, muted tick
 * labels, smooth curves, top-rounded bars. Colors come from the app's
 * chart tokens so light and dark mode both work; the result table next
 * to it is the accessible view.
 */

import type { Cell, ChartSpec } from "~/lib/query-tool";

const WIDTH = 360;
const HEIGHT = 160;
const MARGIN = { top: 12, right: 12, bottom: 22, left: 34 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const MAX_POINTS = 50;

type Point = { x: Cell; y: number; label: string };
type XY = [number, number];

function toNumber(value: Cell): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** 3-5 rounded tick values across [min, max]. */
function yTicks(min: number, max: number): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step = 10 ** Math.floor(Math.log10(span / 3));
  const nice = [1, 2, 5, 10]
    .map((m) => m * step)
    .find((s) => span / s <= 5) ?? step * 10;
  const ticks: number[] = [];
  for (
    let t = Math.ceil(min / nice) * nice;
    t <= max + 1e-9;
    t += nice
  ) {
    ticks.push(Number(t.toFixed(10)));
  }
  return ticks;
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${value / 1_000_000}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

/** Catmull-Rom through the points as cubic beziers: the smooth line. */
function smoothPath(pts: XY[]): string {
  if (pts.length < 3) {
    return pts
      .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
      .join("");
  }
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1: XY = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: XY = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** A bar with only its top corners rounded, anchored on the baseline. */
function barPath(x: number, top: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return [
    `M${(x - w / 2).toFixed(1)},${(top + h).toFixed(1)}`,
    `v${(-(h - r)).toFixed(1)}`,
    `q0,${-r} ${r},${-r}`,
    `h${(w - 2 * r).toFixed(1)}`,
    `q${r},0 ${r},${r}`,
    `v${(h - r).toFixed(1)}`,
    "z",
  ].join("");
}

export function MiniChart({
  spec,
  columns,
  rows,
}: {
  spec: ChartSpec;
  columns: string[];
  rows: Cell[][];
}) {
  const xIdx = columns.indexOf(spec.x);
  const yIdx = columns.indexOf(spec.y);
  if (xIdx === -1 || yIdx === -1) return null;

  const points: Point[] = [];
  for (const row of rows.slice(0, MAX_POINTS)) {
    const y = toNumber(row[yIdx]);
    if (y === null) continue;
    points.push({ x: row[xIdx], y, label: String(row[xIdx] ?? "") });
  }
  if (points.length < 2) return null;

  // Numeric x gets a linear scale (and sorted points) for line/scatter;
  // anything else is an ordered band in row order.
  const xNumbers = points.map((p) => toNumber(p.x));
  const numericX = spec.type !== "bar" && xNumbers.every((n) => n !== null);
  if (numericX) {
    points.sort((a, b) => toNumber(a.x)! - toNumber(b.x)!);
  }

  const ys = points.map((p) => p.y);
  // Bars are anchored at zero (length encodes magnitude); lines and dots
  // use the data's own extent.
  const yMin = spec.type === "bar" ? Math.min(0, ...ys) : Math.min(...ys);
  const yMax = Math.max(...ys, spec.type === "bar" ? 0 : -Infinity);
  const ySpan = yMax - yMin || 1;
  const sy = (v: number) =>
    MARGIN.top + PLOT_H - ((v - yMin) / ySpan) * PLOT_H;

  const xs = numericX ? points.map((p) => toNumber(p.x)!) : [];
  const xMin = numericX ? Math.min(...xs) : 0;
  const xSpan = numericX ? Math.max(...xs) - xMin || 1 : 1;
  const band = PLOT_W / points.length;
  const sx = (p: Point, i: number) =>
    numericX
      ? MARGIN.left + ((toNumber(p.x)! - xMin) / xSpan) * PLOT_W
      : MARGIN.left + band * (i + 0.5);

  const ticks = yTicks(yMin, yMax);
  // Label from the left, keeping a minimum pixel gap so clustered points
  // (e.g. an outlier x value that squeezes the rest) never overlap. The
  // last point is labeled only if it clears the gap.
  const X_LABEL_GAP = 38;
  const xLabels: { x: number; text: string }[] = [];
  let lastLabelX = -Infinity;
  points.forEach((p, i) => {
    const x = sx(p, i);
    if (x - lastLabelX >= X_LABEL_GAP) {
      xLabels.push({ x, text: p.label.slice(0, 10) });
      lastLabelX = x;
    }
  });
  const maxIdx = points.reduce((m, p, i) => (p.y > points[m].y ? i : m), 0);
  // One direct label: the line's landing point, or the tallest bar/dot.
  const labeledIdx = spec.type === "line" ? points.length - 1 : maxIdx;
  const labeled = points[labeledIdx];

  const linePts: XY[] = points.map((p, i) => [sx(p, i), sy(p.y)]);
  const series = "var(--chart-1)";
  const barWidth = Math.min(28, Math.max(3, band - 4));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full"
      role="img"
      aria-label={spec.title ?? `${spec.y} by ${spec.x}`}
    >
      {/* Only a few dashed horizontal gridlines; no axis lines at all */}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={sy(t)}
            y2={sy(t)}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.6}
          />
          <text
            x={MARGIN.left - 6}
            y={sy(t) + 3}
            textAnchor="end"
            fontSize={9}
            fill="var(--muted-foreground)"
            opacity={0.8}
          >
            {formatTick(t)}
          </text>
        </g>
      ))}
      {/* x labels, gap-spaced so they never overlap; no tick marks */}
      {xLabels.map((l, i) => (
        <text
          key={`x${i}`}
          x={l.x}
          y={HEIGHT - 6}
          textAnchor="middle"
          fontSize={9}
          fill="var(--muted-foreground)"
          opacity={0.8}
        >
          {l.text}
        </text>
      ))}
      {spec.type === "line" && (
        <path
          d={smoothPath(linePts)}
          fill="none"
          stroke={series}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {spec.type === "bar" &&
        points.map((p, i) => {
          const zero = sy(Math.max(yMin, 0));
          const top = Math.min(sy(p.y), zero);
          const h = Math.max(1, Math.abs(sy(p.y) - zero));
          return (
            <path key={i} d={barPath(sx(p, i), top, barWidth, h)} fill={series}>
              <title>{`${p.label}: ${p.y}`}</title>
            </path>
          );
        })}
      {/* Dots: all points for scatter, invisible hover targets for line */}
      {points.map((p, i) => (
        <circle
          key={`d${i}`}
          cx={sx(p, i)}
          cy={sy(p.y)}
          r={spec.type === "scatter" ? 4 : 7}
          fill={spec.type === "scatter" ? series : "transparent"}
          stroke={spec.type === "scatter" ? "var(--card)" : "none"}
          strokeWidth={spec.type === "scatter" ? 2 : 0}
        >
          <title>{`${p.label}: ${p.y}`}</title>
        </circle>
      ))}
      {/* One direct label; values wear text ink, not the series color */}
      {spec.type !== "bar" && (
        <text
          x={Math.min(
            Math.max(sx(labeled, labeledIdx), MARGIN.left + 8),
            WIDTH - MARGIN.right - 4,
          )}
          y={Math.max(sy(labeled.y) - 8, 9)}
          textAnchor="middle"
          fontSize={10}
          fontWeight={500}
          fill="var(--foreground)"
        >
          {labeled.y}
        </text>
      )}
    </svg>
  );
}
