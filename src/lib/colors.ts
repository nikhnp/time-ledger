'use client'
/* Colors — category palettes for goals, habits, users (stable by id hash).
 * v11: every palette entry is read from the active theme's --chart-* tokens,
 * so charts re-tint when the appearance changes (Linen/Night/Sage/Clay/Slate). */

import { chartHex } from '@/lib/themeColors'

export interface Cat {
  hex: string
  fs: 'hachure' | 'cross-hatch' | 'zigzag' | 'solid'
}

/** Goal → chart color index + fill style (stable by id hash). */
const CATS: Record<string, { chart: number; fs: Cat['fs'] }> = {
  'deep-work': { chart: 4, fs: 'cross-hatch' },
  learning: { chart: 2, fs: 'hachure' },
  health: { chart: 3, fs: 'zigzag' },
}
const HABIT_CATS: Record<string, number> = {
  meditate: 6,
  'read-bed': 7,
  'plan-tomorrow': 4,
}
const USER_COLORS: Record<string, number> = {
  Asha: 3,
  Bibek: 4,
  Chandra: 1,
  Diya: 2,
  Elina: 6,
}
const FILL_STYLES: Array<Cat['fs']> = ['cross-hatch', 'hachure', 'zigzag']

export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function goalCat(goalId: string | null | undefined, color?: string | null): Cat {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    return { hex: color, fs: 'hachure' }
  }
  const gid = goalId ?? '' // activities may be unfiled (null goalId) — stable palette slot
  const known = CATS[gid]
  if (known) return { hex: chartHex(known.chart), fs: known.fs }
  const idx = hashStr(gid) % 7
  return { hex: chartHex(idx + 1), fs: FILL_STYLES[hashStr(gid + 'fs') % FILL_STYLES.length] }
}

export function habitColor(habitId: string, color?: string | null): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color
  if (HABIT_CATS[habitId]) return chartHex(HABIT_CATS[habitId])
  return chartHex((hashStr(habitId) % 7) + 1)
}

export function userColor(name: string): string {
  if (USER_COLORS[name]) return chartHex(USER_COLORS[name])
  return chartHex((hashStr(name) % 7) + 1)
}

export const STALE_DAYS = 3
