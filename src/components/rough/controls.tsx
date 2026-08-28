'use client'
/* Rough controls — buttons, checkboxes, progress bars, bento cells.
 * Every stroke is drawn by rough.js with fixed seeds, so re-renders don't
 * flicker. v11: colors come from the active theme's tokens and redraw when
 * the appearance switches (useThemeTick). */

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import rough from 'roughjs'
import {
  accentHex, accentDeepHex, inkSoftHex, paperHex, paperCardHex, onAccentHex, useThemeTick,
} from '@/lib/themeColors'

export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/* ---------- measuring hook ---------- */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight) })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, size }
}

/* ---------- the rough rectangle overlay ---------- */
export function RoughRect({
  w, h, solid = false, seed = 11, pad = 2,
}: { w: number; h: number; solid?: boolean; seed?: number; pad?: number }) {
  const ref = useRef<SVGSVGElement>(null)
  const tick = useThemeTick()
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg) return
    svg.innerHTML = ''
    const g = rough.svg(svg)
    /* primary buttons sit on a solid accent fill — stroke them with the deeper
     * accent so the hand-drawn edge reads on top; ghosts get an ink outline */
    const col = solid ? accentDeepHex() : inkSoftHex()
    const opts: Record<string, unknown> = { stroke: col, strokeWidth: 1.6, roughness: 1.5, seed }
    if (solid) Object.assign(opts, { fill: col, fillStyle: 'hachure', fillWeight: 0.9, hachureGap: 6, hachureAngle: -41 })
    svg.appendChild(g.rectangle(pad, pad, w - pad * 2, h - pad * 2, opts))
  }, [w, h, solid, seed, tick])
  return (
    <svg
      ref={ref}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden
      style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', display: 'block', borderRadius: 'inherit' }}
    />
  )
}

/* ---------- button ---------- */
interface RoughBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
  seedKey?: string
  children?: ReactNode
}

export function RoughBtn({ variant = 'ghost', seedKey, children, style, disabled, ...rest }: RoughBtnProps) {
  const { ref, size } = useSize<HTMLButtonElement>()
  const seed = seedKey ? hashStr(seedKey) % 997 : 7
  const solid = variant === 'primary'

  return (
    <button
      ref={ref}
      disabled={disabled}
      style={{
        position: 'relative',
        /* primary: solid accent plate with guaranteed-contrast label.
         * ghost: transparent with ink text — the rough outline draws itself. */
        background: solid ? accentHex() : 'transparent',
        boxShadow: 'none',
        border: 'none',
        color: solid ? onAccentHex() : inkSoftHex(),
        ...(style as CSSProperties),
      }}
      {...rest}
    >
      {size && size.w > 20 && size.h > 10 && <RoughRect w={size.w} h={size.h} solid={solid} seed={seed} />}
      <span style={{ position: 'relative', zIndex: 1, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
        {children}
      </span>
    </button>
  )
}

/* ---------- checkbox (habit checks, task checks) ---------- */
export function RoughCheck({
  done, color, seedKey, large = false, className, ...rest
}: {
  done: boolean
  color?: string
  seedKey: string
  large?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<SVGSVGElement>(null)
  const tick = useThemeTick()
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg) return
    svg.innerHTML = ''
    const g = rough.svg(svg)
    const col = done ? (color ?? accentHex()) : inkSoftHex()
    const seed = hashStr(seedKey) % 97
    svg.appendChild(
      g.ellipse(12, 12, done ? 20 : 21, done ? 20 : 21, done
        ? { fill: col, fillStyle: 'hachure', fillWeight: 1.2, hachureGap: 4, stroke: col, strokeWidth: 1.6, roughness: 1.6, seed }
        : { stroke: col, strokeWidth: 1.6, roughness: 1.8, seed })
    )
  }, [done, color, seedKey, tick])
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      className={className}
      style={{
        position: 'relative',
        width: large ? 28 : 18,
        height: large ? 28 : 18,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: 'none',
        background: 'transparent',
        padding: 0,
      }}
      {...rest}
    >
      <svg ref={ref} width="24" height="24" viewBox="0 0 24 24" aria-hidden style={{ width: '100%', height: '100%', display: 'block' }} />
      {done && <span aria-hidden style={{ position: 'absolute', fontSize: large ? 11 : 9, color: onAccentHex(), fontWeight: 700, pointerEvents: 'none' }}>✓</span>}
    </button>
  )
}

/* ---------- progress track (goal/budget/household bars) ---------- */
export function RoughTrack({
  frac, hex, fillStyle = 'hachure', className, style,
}: { frac: number; hex: string; fillStyle?: string; className?: string; style?: CSSProperties }) {
  const { ref, size } = useSize<HTMLDivElement>()
  const tick = useThemeTick()
  return (
    <div ref={ref} className={className} style={{ height: 18, position: 'relative', ...(style ?? {}) }}>
      {size && size.w > 24 && <RoughBarSvg w={size.w} h={size.h} frac={frac} hex={hex} fillStyle={fillStyle} tick={tick} />}
    </div>
  )
}

function RoughBarSvg({ w, h, frac, hex, fillStyle, tick }: { w: number; h: number; frac: number; hex: string; fillStyle: string; tick: number }) {
  const ref = useRef<SVGSVGElement>(null)
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg) return
    svg.innerHTML = ''
    const g = rough.svg(svg)
    svg.appendChild(g.rectangle(1, 1, w - 2, h - 2, { stroke: inkSoftHex(), strokeWidth: 1.2, roughness: 1.3, seed: 11 }))
    const f = Math.min(1, Math.max(0, frac))
    if (f > 0.015) {
      svg.appendChild(g.rectangle(3, 3, Math.max(4, (w - 6) * f), h - 6, {
        fill: hex, fillStyle, fillWeight: 1.1, hachureGap: 4, stroke: hex, strokeWidth: 1, roughness: 1.2, seed: 23,
      }))
    }
  }, [w, h, frac, hex, fillStyle, tick])
  return <svg ref={ref} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ position: 'absolute', inset: 0, display: 'block' }} />
}

/* ---------- bento cell background ---------- */
export function RoughCell({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  const { ref, size } = useSize<HTMLDivElement>()
  // lint fix (react-hooks/refs): a per-mount random seed is render state,
  // not a ref — useState initializer keeps it stable without ref access.
  const [seed] = useState(() => Math.floor(Math.random() * 999))
  const tick = useThemeTick()
  return (
    /* v11 fix: the padding is back — without it the cell's content sat flush
     * against the hand-drawn border and text collided with the strokes. */
    <div ref={ref} className={className} style={{ position: 'relative', padding: '14px 16px', borderRadius: 10, ...(style ?? {}) }}>
      {size && size.w > 40 && size.h > 40 && <RoughCellSvg w={size.w} h={size.h} seed={seed} tick={tick} />}
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </div>
  )
}

function RoughCellSvg({ w, h, seed, tick }: { w: number; h: number; seed: number; tick: number }) {
  const ref = useRef<SVGSVGElement>(null)
  useLayoutEffect(() => {
    const svg = ref.current
    if (!svg) return
    svg.innerHTML = ''
    const g = rough.svg(svg)
    svg.appendChild(g.rectangle(3, 3, w - 6, h - 6, {
      fill: paperCardHex(), fillStyle: 'solid', stroke: inkSoftHex(), strokeWidth: 1.4, roughness: 1.6, seed,
    }))
  }, [w, h, seed, tick])
  return <svg ref={ref} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', display: 'block' }} />
}
