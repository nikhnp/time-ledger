# Ledger v10.4.0-p1 — Phase 1: Safety & Integrity

> **Start here: [`docs/PHASE1-RUNBOOK.md`](docs/PHASE1-RUNBOOK.md)** — deploy
> checklist, what changed, and emergency procedures.
>
> Phase 1 hardened auth (null-password bypass closed, session tokens hashed,
> rate limits, AES-GCM key encryption), made all multi-step writes
> transactional, added Prisma migrations (the build self-baselines an
> existing `db push` database), fixed the UTC-"today" bug, added a test
> harness (`npm test`), and removed ~40 dead dependencies (bun → npm/node).
> All users are logged out exactly once by the migration — announce it.

# Ledger v10.3 — Comprehensive Contrast Fixes + Settings Cleanup

## TL;DR

v10.3 fixes the systemic contrast failures (white text on light backgrounds) reported in the bug report, cleans up duplicate settings sections, repositions the Admin button to the topbar, and fixes the NaN% bug.

## What changed

### Critical contrast fixes

**1. RoughBtn primary variant was invisible** (`src/components/rough/controls.tsx`)

The `RoughBtn` component with `variant="primary"` had:
```tsx
background: 'transparent',     // ← no background!
color: solid ? accentHex() : undefined,  // ← text same color as hachure fill
```

Result: terracotta text on transparent (cream) background = invisible.

**Fix:** primary variant now has solid accent background + theme-aware label color:
```tsx
background: solid ? accentHex() : 'transparent',
color: solid ? labelHex() : undefined,  // paper-card color = cream in light, dark in dark theme
```

This affects every primary CTA in the app: sign in, sign up, reset password, "Add provider", "Backup all", etc.

**2. Charts had hardcoded `#F5EEDD` text** (`src/components/rough/charts.tsx`)

The Timeline component's bar labels used `fill="#F5EEDD"` (cream) — invisible on the cream paper background where bars have hachure (semi-transparent) fills.

**Fix:** replaced with `fill={paperHex()}` — theme-aware.

**3. Comprehensive CSS contrast overhaul** (`src/app/accessibility-fixes.css`)

Complete rewrite of `accessibility-fixes.css` with:

- **New `--on-accent` token** for each theme — text color that's guaranteed to contrast with `--accent`:
  - Light: `#FFFFFF` (white on terracotta)
  - Dark: `#1C1710` (dark on brightened accent)
  - Sage: `#FFFFFF` (white on sage accent)
  - Clay: `#1C1710` (dark on brightened clay accent)
- **`--ink-faint` darkened** across all 4 themes to meet WCAG AA (4.5:1 ratio on paper background):
  - Light: `#6B5A45` (was `#9A8670`)
  - Dark: `#B5A487` (was `#8A7860`)
  - Sage: `#6B7558` (was `#8C9678`)
  - Clay: `#B89A82` (was `#A9806C`)
- **Defensive `*` reset** — forces all elements to inherit color from parent, never from shadcn's `--primary-foreground` (which is white in `globals.css`)
- **Explicit `color: var(--ink)`** on every component that renders text (cards, panels, dock, sheet, admin panel, settings sections, etc.)
- **`.btn-primary`** now has both `background: var(--accent) !important` AND `color: var(--on-accent) !important` — guaranteed contrast
- **`.btn-ghost`** now has `color: var(--ink) !important` — never white
- **All small UI text** (chips, labels, tags) now uses `--ink-soft` instead of `--ink-faint` for better readability

### Settings architecture cleanup (UX-001 + UX-002)

**4. Removed duplicate "Dock items" section** from SettingsModal

The old section used the legacy `dockOptional` localStorage-based toggle. The v10 "Dock customization" section (using DB-backed `dockConfig`) is the single source of truth now.

**5. Removed duplicate "LLM — voice & text structuring" section** from SettingsModal

The old section used localStorage-based BYO-key. The v10 "LLM providers" section (using DB-backed per-user settings with system-wide fallback) is the single source of truth now. Admin-level system-wide providers are managed in the Admin panel's LLM tab (added in v10.1).

**6. New toggle slider for "Enable"** in Dock customization

Per your mockup, each tool row now has:
- A **toggle slider** (On/Off) for Enable/Disable — replaces the old checkbox
- A **checkbox** for "Keep in dock" — same as before

The toggle uses `role="switch"` + `aria-checked` for accessibility.

### Layout fixes

**7. Admin button moved to top-right of topbar**

Was: in the dock-add-row next to Add button
Now: in the topbar, between "Focus" and the avatar chip

Admins see a shield icon + "Admin" label. On mobile, it's icon-only.

**8. Add button positioned alongside dock on desktop**

Per your request: on desktop, the Add button is now alongside the dock on the right side (in a separate dock-like container with the same styling). On mobile, it stays above the dock.

CSS handles the responsive positioning:
- Desktop (≥768px): `bottom: 14px` — same level as dock
- Mobile (<768px): `bottom: calc(dock-h + 14px)` — above the dock

### Bug fixes

**9. NaN% in WeekView habit completion rate**

```diff
- const habitPct = Math.round((habitHits / (ledger.habits.length * 7)) * 100)
+ const habitPct = ledger.habits.length === 0 ? 0 : Math.round((habitHits / (ledger.habits.length * 7)) * 100)
```

When you have no habits, the percentage now shows `0%` instead of `NaN%`.

### Debug strings

The bug report mentioned "Add admin here" and "remove this text" debug strings on the Today page. I searched the entire codebase and couldn't find them — they're likely from your local edits (not pushed to the repo you uploaded) or LLM-generated content. If they persist after deploying v10.3, share a screenshot of where they appear and I'll hunt them down.

## Files modified (6)

| File | Change |
|------|--------|
| `src/components/rough/controls.tsx` | RoughBtn primary variant: solid accent bg + theme-aware label color (was transparent + accent text = invisible) |
| `src/components/rough/charts.tsx` | Timeline bar labels: replace hardcoded `#F5EEDD` with theme-aware `paperHex()` |
| `src/app/accessibility-fixes.css` | Complete rewrite — comprehensive contrast fixes for all 4 themes + new toggle slider CSS + topbar admin button CSS |
| `src/components/views/WeekView.tsx` | Guard NaN% when no habits exist |
| `src/components/SettingsModal.tsx` | Removed duplicate "Dock items" + "LLM — voice & text structuring" sections; new toggle slider for Enable in V10DockSection |
| `src/components/AppShell.tsx` | Admin button moved to TopBar (top-right); Add button alone in dock-add-row (alongside dock on desktop, above on mobile) |

## Apply steps

```bash
unzip -o /home/z/my-project/download/updated-time-ledger-v10.3.zip -d /tmp/ledger-fix-v10.3
cd /home/time-ledger
bash /tmp/ledger-fix-v10.3/apply-fixes.sh

git add -A
git commit -m 'fix(v10.3): comprehensive contrast fixes; merge duplicate settings; Admin to topbar; NaN% fix'
git push
```

## After deploy

1. **Hard-refresh** (Cmd/Ctrl+Shift+R) — critical, since the old CSS is cached
2. **Sign in / sign up** — buttons should now be clearly visible (accent bg + cream text)
3. **Today view** — all stats text should be dark ink on cream background (no more white-on-white)
4. **Settings** — only ONE "Dock customization" section (with toggle sliders) + ONE "LLM providers" section
5. **Topbar** — Admin button visible top-right (admins only)
6. **Dock** — Add button alongside on desktop (right side), above on mobile
7. **Week view** — "habits hit" percentage shows `0%` instead of `NaN%` when no habits
8. **Switch themes** (Settings → Appearance) — verify contrast is good in all 4: Linen, Night, Sage, Clay

## If you still see white-on-white text

The bug report was very specific about screens and elements. I've fixed:
- All RoughBtn primary buttons (sign in, sign up, reset, add provider, backup all, etc.)
- Chart labels (timeline bars)
- All cards/panels (explicit `color: var(--ink)`)
- All small UI text (chips, labels, tags)
- Defensive `*` reset to prevent inheritance from shadcn globals.css

If you still see issues after deploying v10.3, please share:
1. Which theme you're in (Linen / Night / Sage / Clay)
2. Which screen (sign in, today, week, etc.)
3. Which specific element (button, text, icon)
4. A screenshot if possible

The most likely remaining causes would be:
- A component I didn't audit (there are many — I focused on the ones mentioned in the bug report)
- An inline style somewhere that hardcodes `color: '#fff'` or similar
- A shadcn UI component (Button, Badge, etc.) being used somewhere with `text-primary-foreground` without the matching `bg-primary`

I'll do a follow-up sweep if you point me at the specific remaining issues.
