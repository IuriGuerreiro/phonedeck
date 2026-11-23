// Tiny single-series SVG charts with a hover tooltip. One series each, so no legend:
// the card title names it. Marks use the primary color; text stays in text colors.
import { useState } from "react";

type Point = { label: string; value: number };

const W = 600;
const H = 160;
const PAD = { top: 12, right: 8, bottom: 22, left: 36 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

function Frame({ max, data, unit, children, hover, setHover, xFor }: {
  max: number;
  data: Point[];
  unit: string;
  children: React.ReactNode;
  hover: number | null;
  setHover: (i: number | null) => void;
  xFor: (i: number) => number;
}) {
  const ticks = [0, max / 2, max];
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * plotW;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round((px / plotW) * (data.length - 1)))));
  }

  const h = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {Math.round(t).toLocaleString()}
            </text>
          </g>
        ))}
        {[0, data.length - 1].map((i) => (
          <text key={i} x={xFor(i)} y={H - 6} textAnchor={i === 0 ? "start" : "end"} className="fill-muted-foreground text-[10px]">
            {data[i]?.label}
          </text>
        ))}
        {children}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap shadow-sm"
          style={{ left: `${(xFor(hover) / W) * 100}%` }}
        >
          <div className="text-muted-foreground">{h.label}</div>
          <div className="font-medium tabular-nums">
            {h.value.toLocaleString()} {unit}
          </div>
        </div>
      )}
    </div>
  );
}

export function BarChart({ data, unit }: { data: Point[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const slot = plotW / data.length;
  const barW = Math.max(2, slot - 2); // 2px gap between bars
  const xFor = (i: number) => PAD.left + slot * i + slot / 2;
  const base = PAD.top + plotH;

  return (
    <Frame max={max} data={data} unit={unit} hover={hover} setHover={setHover} xFor={xFor}>
      {data.map((d, i) => {
        const h = (d.value / max) * plotH;
        const r = Math.min(4, barW / 2, h);
        const x = xFor(i) - barW / 2;
        // Rounded top, square bottom on the baseline.
        const path = h
          ? `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barW - r} Q${x + barW},${base - h} ${x + barW},${base - h + r} V${base} Z`
          : "";
        return (
          <path key={d.label} d={path} className="fill-primary" opacity={hover === null || hover === i ? 1 : 0.45} />
        );
      })}
    </Frame>
  );
}

export function LineChart({ data, unit }: { data: Point[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = data.map((d) => d.value);
  const max = niceMax(Math.max(...values));
  const xFor = (i: number) => PAD.left + (data.length <= 1 ? 0 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const line = data.map((d, i) => `${i ? "L" : "M"}${xFor(i)},${y(d.value)}`).join(" ");

  return (
    <Frame max={max} data={data} unit={unit} hover={hover} setHover={setHover} xFor={xFor}>
      <path d={line} fill="none" className="stroke-primary" strokeWidth={2} strokeLinejoin="round" />
      {hover !== null && (
        <>
          <line x1={xFor(hover)} x2={xFor(hover)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-muted-foreground" strokeDasharray="3 3" />
          <circle cx={xFor(hover)} cy={y(data[hover].value)} r={4} className="fill-primary stroke-background" strokeWidth={2} />
        </>
      )}
    </Frame>
  );
}
