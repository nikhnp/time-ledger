'use client'
/* Rough charts — every graph hand-drawn by rough.js, fixed seeds, pure data props.
 * v11: every color is pulled from the active theme (Linen/Night/Sage/Clay/Slate)
 * and the art redraws when the appearance switches. */

import { useLayoutEffect, useRef } from 'react'
import rough from 'roughjs'
import { isoLocal, d2s } from '@/lib/dates'
import type { Cat } from '@/lib/colors'
import {
  accentHex, inkSoftHex, inkFaintHex, paperHex, goodHex, warnHex, badHex, withAlpha, useThemeTick,
} from '@/lib/themeColors'

export const MONO = 'var(--fm), ui-monospace, monospace'

/* use a rough drawing effect: fn receives the rough generator + svg element */
function useRough(draw: (g: ReturnType<typeof rough.svg>, svg: SVGSVGElement) => void, deps: unknown[]) {
  const ref = useRef<SVGSVGElement>(null)
  const tick = useThemeTick()
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg) return
    svg.innerHTML = ''
    draw(rough.svg(svg), svg)
     
  }, [...deps, tick])
  return ref
}

/* ---------- sparkline (numbers bento) ---------- */
export function Spark({ values, color }: { values: number[]; color: string }) {
  const ref = useRough((g, svg) => {
    const w = 160, h = 52, pad = 8
    const max = Math.max(1, ...values)
    const pts = values.map((v, i) => [pad + (i * (w - 2 * pad)) / (values.length - 1), h - pad - (v / max) * (h - 2 * pad)] as [number, number])
    svg.appendChild(g.line(pad, h - pad, w - pad, h - pad, { stroke: inkFaintHex(), strokeWidth: 1, roughness: 1, seed: 2 }))
    svg.appendChild(g.linearPath(pts, { stroke: color, strokeWidth: 2, roughness: 1.6, seed: 3 }))
    const last = pts[pts.length - 1]
    svg.appendChild(g.ellipse(last[0], last[1], 14, 14, { stroke: accentHex(), strokeWidth: 1.6, roughness: 2, seed: 4 }))
  }, [values, color])
  return <svg ref={ref} viewBox="0 0 160 52" aria-hidden style={{ width: '100%', height: '100%', display: 'block' }} />
}

/* ---------- streak dots ---------- */
export function Dots({ bools, color }: { bools: boolean[]; color: string }) {
  const ref = useRough((g, svg) => {
    bools.forEach((b, i) => {
      const cx = 12 + i * 21
      svg.appendChild(g.circle(cx, 15, 12, b
        ? { fill: color, fillStyle: 'hachure', fillWeight: 1.1, hachureGap: 3.5, stroke: color, strokeWidth: 1.3, roughness: 1.5, seed: 5 + i }
        : { stroke: inkFaintHex(), strokeWidth: 1.3, roughness: 1.6, seed: 5 + i }))
    })
  }, [bools, color])
  return <svg ref={ref} viewBox="0 0 160 30" aria-hidden style={{ width: '100%', height: '100%', display: 'block' }} />
}

/* ---------- tally marks ---------- */
export function Tally({ n, color }: { n: number; color: string }) {
  const ref = useRough((g, svg) => {
    if (n === 0) {
      /* empty state — a short hand-drawn dash so the card doesn't read as broken */
      svg.appendChild(g.line(52, 22, 108, 22, { stroke: inkFaintHex(), strokeWidth: 2, roughness: 2, seed: 8 }))
      return
    }
    let x = 10
    for (let i = 0; i < Math.min(n, 14); i++) {
      if (i > 0 && i % 5 === 0) x += 11
      svg.appendChild(g.line(x, 9, x, 35, { stroke: color, strokeWidth: 2.4, roughness: 1.8, seed: 9 + i }))
      if (i > 0 && i % 5 === 4) svg.appendChild(g.line(x - 34, 31, x + 2, 13, { stroke: color, strokeWidth: 1.8, roughness: 1.7, seed: 20 + i }))
      x += 11
    }
  }, [n, color])
  return <svg ref={ref} viewBox="0 0 160 44" aria-hidden style={{ width: '100%', height: '100%', display: 'block' }} />
}

/* ---------- progress box ---------- */
export function ProgressBox({ frac, color }: { frac: number; color: string }) {
  const ref = useRough((g, svg) => {
    svg.appendChild(g.rectangle(4, 6, 148, 24, { stroke: color, strokeWidth: 1.6, roughness: 1.5, seed: 31 }))
    if (frac > 0.01) {
      svg.appendChild(g.rectangle(7, 9, Math.max(4, 142 * Math.min(1, frac)), 18, {
        fill: color, fillStyle: 'hachure', fillWeight: 1.1, hachureGap: 4, stroke: color, strokeWidth: 0.8, roughness: 1.2, seed: 32,
      }))
    }
  }, [frac, color])
  return <svg ref={ref} viewBox="0 0 160 36" aria-hidden style={{ width: '100%', height: '100%', display: 'block' }} />
}

/* ---------- GitHub-style contribution grid (12 weeks) ---------- */
export function GhGrid({ cells, hex }: { cells: Array<{ date: string; done: boolean }>; hex: string }) {
  const ref = useRough((g, svg) => {
    cells.forEach((c, i) => {
      const col = Math.floor(i / 7), row = i % 7
      const x = col * 13, y = row * 13
      const rect = g.rectangle(x, y, 10, 10, c.done
        ? { fill: hex, fillStyle: 'solid', stroke: hex, strokeWidth: 1, roughness: 0.9, seed: 733 + i }
        : { stroke: inkFaintHex(), strokeWidth: 0.9, roughness: 1.1, seed: 733 + i })
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title')
      t.textContent = `${c.date}${c.done ? ' — done' : ''}`
      rect.appendChild(t)
      svg.appendChild(rect)
    })
  }, [cells, hex])
  const cols = Math.ceil(cells.length / 7)
  const w = cols * 13, h = 7 * 13
  return <svg ref={ref} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: 'block' }} />
}

/* ---------- fortnight bar chart ---------- */
export function Fortnight({ values }: { values: number[] }) {
  const ref = useRough((g, svg) => {
    const w = 380, h = 160
    const max = Math.max(1, ...values)
    values.forEach((v, i) => {
      const x = 8 + i * 26.4
      const bh = Math.max(3, (v / max) * 118)
      const y = 140 - bh
      svg.appendChild(g.rectangle(x, y, 17, bh, { fill: accentHex(), fillStyle: 'hachure', fillWeight: 1.1, hachureGap: 4, stroke: accentHex(), strokeWidth: 1, roughness: 1.3, seed: 40 + i }))
    })
    svg.appendChild(g.line(4, 140, w - 4, 140, { stroke: inkFaintHex(), strokeWidth: 1.2, roughness: 1, seed: 60 }))
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    const ay = 140 - (avg / max) * 118
    svg.appendChild(g.line(4, ay, w - 4, ay, { stroke: goodHex(), strokeWidth: 1.6, roughness: 1.2, strokeLineDash: [6, 5], seed: 61 }))
  }, [values])
  return <svg ref={ref} viewBox="0 0 380 160" aria-hidden style={{ width: '100%', height: 'auto', display: 'block' }} />
}

/* ---------- where the hours went (today) ---------- */
export interface HoursRow { name: string; hours: number; cat: Cat }

export function HoursToday({ rows, total }: { rows: HoursRow[]; total: number }) {
  const w = 640
  const h = rows.length * 54 + 10
  const ref = useRough((g, svg) => {
    const max = Math.max(1, ...rows.map((r) => r.hours))
    const barX = 185, barW = w - 185 - 64
    rows.forEach((r, i) => {
      const y = i * 54 + 8
      const bw = Math.max(6, (r.hours / max) * barW)
      svg.appendChild(g.rectangle(barX, y, barW, 30, { stroke: inkFaintHex(), strokeWidth: 1.1, roughness: 1.3, seed: 70 + i }))
      svg.appendChild(g.rectangle(barX + 2, y + 2, Math.max(4, bw - 4), 26, {
        fill: r.cat.hex, fillStyle: r.cat.fs, fillWeight: 1.1, hachureGap: 4, stroke: r.cat.hex, strokeWidth: 1, roughness: 1.2, seed: 80 + i,
      }))
    })
  }, [rows])
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg ref={ref} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ width: '100%', height: 'auto', display: 'block' }} />
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {rows.map((r, i) => {
          const y = i * 54 + 8
          return (
            <g key={i}>
              <text x={8} y={y + 21} fontSize={13} fill={inkSoftHex()} fontWeight={600}>{r.name.length > 26 ? `${r.name.slice(0, 25)}…` : r.name}</text>
              <text x={w - 8} y={y + 21} fontSize={13} fill={inkSoftHex()} textAnchor="end" fontFamily={MONO} fontWeight={700}>{r.hours}h</text>
            </g>
          )
        })}
        <text x={8} y={h - 2} fontSize={11} fill={inkFaintHex()} fontFamily={MONO}>total: {total.toFixed(1)}h logged</text>
      </svg>
    </div>
  )
}

/* ---------- timeline (6am–midnight) ---------- */
export interface TlBlock { startMin: number; endMin: number; label: string; cat: Cat }

export function Timeline({ blocks }: { blocks: TlBlock[] }) {
  const w = 760, h = 76
  const ref = useRough((g, svg) => {
    svg.appendChild(g.line(4, h - 10, w - 4, h - 10, { stroke: inkFaintHex(), strokeWidth: 1.2, roughness: 1, seed: 101 }))
    const T0 = 360, SPAN = 1080
    blocks.forEach((b, i) => {
      const s = Math.max(T0, Math.min(b.startMin, T0 + SPAN))
      const e = Math.max(s + 15, Math.min(b.endMin, T0 + SPAN))
      const x = 4 + ((s - T0) / SPAN) * (w - 8)
      const bw = Math.max(10, ((e - s) / SPAN) * (w - 8))
      svg.appendChild(g.rectangle(x, 10, bw, h - 24, {
        fill: b.cat.hex, fillStyle: b.cat.fs, fillWeight: 1, hachureGap: 5, stroke: b.cat.hex, strokeWidth: 1.1, roughness: 1.3, seed: 110 + i,
      }))
    })
  }, [blocks])
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg ref={ref} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ width: '100%', height: 'auto', display: 'block' }} />
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {blocks.map((b, i) => {
          const T0 = 360, SPAN = 1080
          const s = Math.max(T0, Math.min(b.startMin, T0 + SPAN))
          const e = Math.max(s + 15, Math.min(b.endMin, T0 + SPAN))
          const x = 4 + ((s - T0) / SPAN) * (w - 8)
          const bw = Math.max(10, ((e - s) / SPAN) * (w - 8))
          return bw > 78 ? (
            <text key={i} x={x + bw / 2} y={44} fontSize={11} fill={paperHex()} textAnchor="middle" fontWeight={600}>{b.label.split(' ')[0]}</text>
          ) : null
        })}
      </svg>
    </div>
  )
}

/* ---------- focus gauge ---------- */
export function FocusGauge({ score }: { score: number }) {
  const ref = useRough((g, svg) => {
    const cx = 85, cy = 85, r = 70
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25
    const pt = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number]
    const [x0, y0] = pt(a0), [x1, y1] = pt(a1)
    svg.appendChild(g.path(`M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 1 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`, { stroke: inkFaintHex(), strokeWidth: 2, roughness: 1.4, seed: 120 }))
    if (score > 0) {
      const av = a0 + (a1 - a0) * (score / 100)
      const [xv, yv] = pt(av)
      const col = score >= 60 ? goodHex() : score >= 35 ? warnHex() : badHex()
      const large = av - a0 > Math.PI ? 1 : 0
      svg.appendChild(g.path(`M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${xv.toFixed(1)} ${yv.toFixed(1)}`, { stroke: col, strokeWidth: 6, roughness: 1.5, seed: 121 }))
    }
  }, [score])
  return <svg ref={ref} viewBox="0 0 170 170" aria-hidden style={{ width: '100%', height: 'auto', display: 'block' }} />
}

/* ---------- hero strip (hours today bricks) ---------- */
export function HeroStrip({ acts }: { acts: Array<{ hours: number; cat: Cat }> }) {
  const ref = useRough((g, svg) => {
    const w = 320, h = 24
    const total = Math.max(0.1, acts.reduce((s, a) => s + a.hours, 0))
    let x = 2
    acts.forEach((a, i) => {
      const bw = Math.max(8, (a.hours / total) * (w - 4))
      svg.appendChild(g.rectangle(x, 2, Math.min(bw, w - 4 - x), h - 4, {
        fill: a.cat.hex, fillStyle: a.cat.fs, fillWeight: 1, hachureGap: 4, stroke: a.cat.hex, strokeWidth: 1, roughness: 1.2, seed: 130 + i,
      }))
      x += bw
    })
  }, [acts])
  return <svg ref={ref} viewBox="0 0 320 24" aria-hidden style={{ width: '100%', height: 'auto', display: 'block' }} />
}

/* ---------- week stacked-by-day chart ---------- */
export interface WeekStack { label: string; total: number; blocks: Array<{ hours: number; cat: Cat }> }

export function WeekChart({ stacks }: { stacks: WeekStack[] }) {
  const w = 640, h = 250
  const ref = useRough((g, svg) => {
    const max = Math.max(1, ...stacks.map((s) => s.total))
    const colW = w / 7, baseY = h - 34
    svg.appendChild(g.line(6, baseY, w - 6, baseY, { stroke: inkFaintHex(), strokeWidth: 1.2, roughness: 1, seed: 140 }))
    stacks.forEach((s, i) => {
      const x = colW * i + colW * 0.18
      const bw = colW * 0.64
      let y = baseY
      s.blocks.forEach((b, ai) => {
        const bh = Math.max(2, (b.hours / max) * (baseY - 30))
        y -= bh
        svg.appendChild(g.rectangle(x, y, bw, bh, {
          fill: b.cat.hex, fillStyle: b.cat.fs, fillWeight: 1.1, hachureGap: 4, stroke: b.cat.hex, strokeWidth: 1, roughness: 1.3, seed: 150 + i * 10 + ai,
        }))
      })
    })
  }, [stacks])
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg ref={ref} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ width: '100%', height: 'auto', display: 'block' }} />
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {stacks.map((s, i) => {
          const max = Math.max(1, ...stacks.map((x) => x.total))
          const colW = w / 7, baseY = h - 34
          return (
            <g key={i}>
              <text x={colW * i + colW / 2} y={h - 14} fontSize={12} fill={inkSoftHex()} textAnchor="middle" fontWeight={600}>{s.label}</text>
              {s.total > 0 && (
                <text x={colW * i + colW / 2} y={baseY - (s.total / max) * (baseY - 30) - 8} fontSize={10} fill={inkFaintHex()} textAnchor="middle" fontFamily={MONO}>{s.total.toFixed(1)}h</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ---------- 18-week consistency heatmap ---------- */
export function Heatmap({ cells }: { cells: Array<{ date: string; hours: number }> }) {
  const cols = 18, cell = 13, gap = 3
  const w = cols * (cell + gap) + 4, h = 7 * (cell + gap) + 4
  const ref = useRough((g, svg) => {
    const accent = accentHex()
    cells.forEach((c, i) => {
      const col = Math.floor(i / 7), row = i % 7
      const x = 2 + col * (cell + gap), y = 2 + row * (cell + gap)
      const hrs = c.hours
      const alpha = hrs <= 0 ? 0 : hrs <= 1 ? 0.22 : hrs <= 2.5 ? 0.45 : hrs <= 4 ? 0.7 : 1
      const rect = g.rectangle(x, y, cell, cell, alpha > 0
        ? { fill: withAlpha(accent, alpha), fillStyle: 'solid', stroke: withAlpha(accent, Math.min(1, alpha + 0.2)), strokeWidth: 1, roughness: 1.2, seed: 200 + i }
        : { stroke: inkFaintHex(), strokeWidth: 0.9, roughness: 1.3, seed: 200 + i })
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title')
      t.textContent = `${c.date} — ${hrs ? `${hrs.toFixed(1)}h` : 'no data'}`
      rect.appendChild(t)
      svg.appendChild(rect)
    })
  }, [cells])
  return <svg ref={ref} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ width: '100%', maxWidth: 560, height: 'auto', display: 'block' }} />
}

/* ---------- month donut ---------- */
export interface DonutSeg { name: string; hex: string; fs: string; h: number }

export function Donut({ segs, total }: { segs: DonutSeg[]; total: number }) {
  const ref = useRough((g, svg) => {
    const cx = 110, cy = 110, r = 92
    let a0 = -Math.PI / 2
    const t = total || 1
    segs.forEach((s, i) => {
      const a1 = a0 + (s.h / t) * 2 * Math.PI
      const p1 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)]
      const p2 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)]
      const large = a1 - a0 > Math.PI ? 1 : 0
      svg.appendChild(g.path(`M ${cx} ${cy} L ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} A ${r} ${r} 0 ${large} 1 ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} Z`, {
        fill: s.hex, fillStyle: s.fs, fillWeight: 1.2, hachureGap: 5, stroke: s.hex, strokeWidth: 1.4, roughness: 1.3, seed: 300 + i,
      }))
      a0 = a1
    })
  }, [segs, total])
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg ref={ref} viewBox="0 0 220 220" aria-hidden style={{ width: '100%', height: 'auto', display: 'block' }} />
      <svg viewBox="0 0 220 220" aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <text x={110} y={117} fontSize={24} fill={inkSoftHex()} textAnchor="middle" fontFamily={MONO} fontWeight={700}>{Math.round(total)}h</text>
      </svg>
    </div>
  )
}

/* ---------- focus session ring (frac = remaining fraction) ---------- */
export function FocusRing({ frac }: { frac: number }) {
  const ref = useRough((g, svg) => {
    const cx = 85, cy = 85, r = 70
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25
    const [x0, y0] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)]
    const [x1, y1] = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)]
    svg.appendChild(g.path(`M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 1 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`, { stroke: inkFaintHex(), strokeWidth: 2.5, roughness: 1.4, seed: 400 }))
    const f = Math.min(1, Math.max(0, frac))
    if (f > 0.01) {
      const av = a0 + (a1 - a0) * f
      const [xm, ym] = [cx + r * Math.cos(av), cy + r * Math.sin(av)]
      const large = av - a0 > Math.PI ? 1 : 0
      svg.appendChild(g.path(`M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${xm.toFixed(1)} ${ym.toFixed(1)}`, { stroke: accentHex(), strokeWidth: 6, roughness: 1.5, seed: 401 }))
    }
  }, [frac])
  return <svg ref={ref} viewBox="0 0 170 170" aria-hidden style={{ width: '100%', height: 'auto', display: 'block' }} />
}

/* ---------- screen time ring (Digital Wellbeing style) ---------- */
export function ScreenRing({ frac, color }: { frac: number; color?: string }) {
  const ref = useRough((g, svg) => {
    const cx = 85, cy = 85, r = 70
    const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2
    const [x0, y0] = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)]
    svg.appendChild(g.circle(cx, cy, r * 2, { stroke: inkFaintHex(), strokeWidth: 2.5, roughness: 1.4, seed: 500 }))
    const f = Math.min(1, Math.max(0, frac))
    if (f > 0.005) {
      const av = a0 + (a1 - a0) * f
      const [xm, ym] = [cx + r * Math.cos(av), cy + r * Math.sin(av)]
      const large = av - a0 > Math.PI ? 1 : 0
      svg.appendChild(g.path(`M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${xm.toFixed(1)} ${ym.toFixed(1)}`, { stroke: color ?? accentHex(), strokeWidth: 7, roughness: 1.5, seed: 501 }))
    }
  }, [frac, color])
  return <svg ref={ref} viewBox="0 0 170 170" aria-hidden style={{ width: '100%', height: 'auto', display: 'block' }} />
}

/* ---------- precomputed cell helpers ---------- */
export function ghCells(isDone: (date: string) => boolean): Array<{ date: string; done: boolean }> {
  const end = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 83)
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  const n = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
  const out: Array<{ date: string; done: boolean }> = []
  for (let i = 0; i < n; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    const ds = d2s(d)
    out.push({ date: ds, done: isDone(ds) })
  }
  return out
}

export function heatCells(hoursFor: (date: string) => number): Array<{ date: string; hours: number }> {
  const end = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (18 * 7 - 1))
  const out: Array<{ date: string; hours: number }> = []
  const cols = 18
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(start)
      d.setUTCDate(d.getUTCDate() + c * 7 + r)
      if (d > end) continue
      const ds = isoLocal(d)
      out.push({ date: ds, hours: hoursFor(ds) })
    }
  }
  return out
}
