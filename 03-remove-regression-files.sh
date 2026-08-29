#!/usr/bin/env bash
# =============================================================================
# 03-remove-regression-files.sh — Ledger v10.4.0-p1
#
# Removes stray files that were re-introduced by commit a64ec3b ("security
# chages"). Those files came from an old local folder state and were merged
# back in; they are either dead code or security regressions:
#
#   SECURITY REGRESSIONS (must go):
#     src/app/api/auth/db-test/route.ts    unauthenticated DB diagnostic
#     src/app/api/auth/env-check/route.ts  unauthenticated env diagnostic
#
#   MULTIPLE-LOCKFILES ERROR (VS Code "Found multiple lockfiles"):
#     bun.lock                             repo uses npm (package-lock.json)
#
#   DEAD CODE (shadcn/ui scaffold; nothing imports them, their packages
#   are not even installed):
#     components.json, tailwind.config.ts, src/components/ui/,
#     src/components/tabs/, src/hooks/, src/lib/utils.ts
#
# Usage:
#   bash 03-remove-regression-files.sh [PROJECT_DIR]
#   PROJECT_DIR defaults to the current directory.
# =============================================================================
set -uo pipefail

PROJECT_DIR="${1:-.}"
cd "$PROJECT_DIR" || { echo "FATAL: cannot cd into '$PROJECT_DIR'"; exit 1; }
echo "Project dir: $(pwd)"

if [ ! -f package.json ]; then
  echo "FATAL: package.json not found here — run this from the repo root,"
  echo "       or pass the path: bash $0 /home/time-ledger"
  exit 1
fi

REMOVED=0
SKIPPED=0

remove_path() {
  local target="$1" label="$2"
  if [ ! -e "$target" ]; then
    echo "  [skip] $label — already absent ($target)"
    return
  fi
  rm -rf "$target"
  echo "  [OK]   removed $target   ($label)"
  REMOVED=$((REMOVED + 1))
}

guard_no_importers() {
  # $1 = import specifier to grep, remaining = allowed importer path prefixes
  local spec="$1"; shift
  local hits
  hits=$(grep -rl --include='*.ts' --include='*.tsx' "$spec" src 2>/dev/null | grep -v -e '^src/components/ui/' -e '^src/hooks/use-' -e '^$' || true)
  if [ -n "$hits" ]; then
    echo "  [WARN] found unexpected importers of $spec — NOT removing to be safe:"
    echo "$hits" | sed 's/^/         /'
    return 1
  fi
  return 0
}

echo
echo "== 1. Security regressions (unauthenticated diagnostic endpoints) =="
remove_path "src/app/api/auth/db-test"   "unauthenticated DB diagnostic endpoint"
remove_path "src/app/api/auth/env-check" "unauthenticated env diagnostic endpoint"

echo
echo "== 2. Lockfile conflict (keeps package-lock.json, the npm one) =="
if [ -f package-lock.json ]; then
  remove_path "bun.lock" "secondary lockfile — fixes 'Found multiple lockfiles'"
else
  echo "  [WARN] package-lock.json missing — keeping bun.lock to avoid having"
  echo "         no lockfile at all. Restore package-lock.json from git first:"
  echo "         git checkout HEAD -- package-lock.json"
  SKIPPED=$((SKIPPED + 1))
fi

echo
echo "== 3. Dead shadcn/ui scaffold (unused, deps not installed) =="
if guard_no_importers 'components/ui/'; then
  remove_path "src/components/ui"      "48 unused shadcn/ui components"
else
  SKIPPED=$((SKIPPED + 1))
fi
if [ -d src/components/tabs ]; then
  remove_path "src/components/tabs"    "empty leftover directory"
fi
if guard_no_importers 'hooks/use-toast' && guard_no_importers 'hooks/use-mobile'; then
  remove_path "src/hooks"              "use-mobile.ts + use-toast.ts (unused shadcn hooks)"
else
  SKIPPED=$((SKIPPED + 1))
fi
if guard_no_importers '@/lib/utils' && guard_no_importers 'lib/utils"'; then
  remove_path "src/lib/utils.ts"       "shadcn cn() helper (unused)"
else
  SKIPPED=$((SKIPPED + 1))
fi
remove_path "components.json"            "shadcn CLI config (unused)"
remove_path "tailwind.config.ts"         "unneeded — Tailwind v4 is CSS-first (globals.css @theme)"

echo
echo "== Summary =="
echo "  Removed: $REMOVED target(s), skipped: $SKIPPED"
echo
echo "== Next steps =="
echo "  1. Verify the build still passes:"
echo "       [ -d node_modules ] && npm run typecheck || echo '(node_modules absent — typecheck will run in CI/Netlify)'"
echo "  2. Commit the removals:"
echo "       git add -A && git commit -m 'chore: remove stray files re-added by a64ec3b (fixes lockfile conflict, restores P1 hardening)'"
echo "  3. Push — Netlify rebuilds."
