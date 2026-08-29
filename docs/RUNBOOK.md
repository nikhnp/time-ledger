# Ledger Runbook — ops after Phase 3

**Audience:** you, at 2am, when something is wrong. Every recipe here was
executed at least once during the build. Nothing in here is tribal memory.

---

## 1. Environment variables (post-P3)

| Variable | Required | Used by | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | everywhere | Neon pooled connection string |
| `LLM_ENCRYPTION_KEY` | yes | `src/lib/server/crypto.ts` | `openssl rand -base64 32`; encrypts stored LLM API keys (AES-256-GCM) |
| `CRON_SECRET` | yes (for purge) | `/api/admin/purge` | long random string; header-compare |
| `LLM_DAILY_TOKEN_BUDGET` | no | `generateJson` + `/api/llm/chat` | per-user daily token cap; default 50,000 |
| `SIGNUP_INVITE_CODE` | no | signup route | unset = open signup |
| `UPSTASH_REDIS_REST_URL/TOKEN` | no | `rate-limit.ts` | unset = in-memory per-instance limiting |

Netlify → Site configuration → Environment variables. Every change triggers a
redeploy; migrations run at build (`scripts/ci/migrate-safe.mjs`).

## 2. Rotate `LLM_ENCRYPTION_KEY` (P1-1e script, parameterized)

Stored keys are `v2:` AES-256-GCM blobs. Rotating the key without re-encrypting
makes every stored key unreadable (the UI shows "(unreadable — re-enter)" — no
crash, but re-entry is annoying).

1. `openssl rand -base64 32` → `NEW_KEY`.
2. Set `LLM_ENCRYPTION_KEY=NEW_KEY` **plus** `LLM_ENCRYPTION_KEY_OLD=<current>`
   in the environment, deploy.
3. Admin → POST `/api/admin/maintenance` `{ "job": "reencrypt-llm-keys" }`.
4. Remove `LLM_ENCRYPTION_KEY_OLD`. Done.

## 3. Rotate `CRON_SECRET`

1. Generate: `openssl rand -hex 32`.
2. Update the secret wherever the purge job calls from (Netlify scheduled
   function env, GitHub secret, or your cron host).
3. Update `CRON_SECRET` in Netlify env → redeploy.
4. `curl -s -X POST https://<site>/.netlify/functions/purge -H "x-cron-secret: <new>"` → `{"ok":true,...}`.

## 4. Restore-from-backup drill (quarterly — actually do it)

Nightly `pg_dump` artifacts land in GitHub Actions (see
`docs/backup.yml.example` — copy to `.github/workflows/backup.yml`). 30-day
retention.

1. Download the newest `ledger-backup-*.dump` artifact.
2. Create a **Neon branch** (never restore over prod):
   `neonctl branches create --name restore-drill`.
3. Restore into it:
   `pg_restore --dbname "$NEON_BRANCH_URL" --no-owner --no-privileges ledger-backup-YYYYMMDD.dump`
4. Boot the app against the branch (local: `DATABASE_URL=<branch> npm run dev`)
   and click through: login → Today → capture → review.
5. If you ever need this for REAL: restore into a fresh branch, verify, then
   point `DATABASE_URL` at the branch (Netlify env) — do **not** pg_restore
   over the live database.

## 5. Neon branch verification recipe (schema changes)

Schema changes ship as hand-reviewed SQL in `prisma/migrations/…` applied by
`migrate-safe` at Netlify build. To verify before prod:

1. Branch: `neonctl branches create --name wp-verify`.
2. `DATABASE_URL=<branch> node scripts/ci/migrate-safe.mjs` — applies
   baseline `0_init` + every migration in order.
3. `npx prisma db pull` against the branch must match `schema.prisma`
   (the CI drift check does exactly this against an empty database).

## 6. Daily purge schedule

The sweep deletes expired sessions, ended impersonation sessions, and stale
reset tokens. Wire it once, forget it:

- **Netlify scheduled function**: create `netlify/functions/purge.js` that
  POSTs to `/api/admin/purge` with `x-cron-secret: process.env.CRON_SECRET`;
  schedule `0 3 * * *` in `netlify.toml`.
- **Or any cron host**: `curl -s -X POST https://<site>/api/admin/purge -H "x-cron-secret: $CRON_SECRET"`.

Verify weekly: the response JSON shows the purged counts; non-zero = alive.

## 7. "All users must re-login" announcement template

(Used when a session-table migration forces a logout — e.g. the P1-1c token
hash migration.)

> **The ledger had to rebind its locks.** Everyone needs to sign in again —
> one time, takes ten seconds. Your book is exactly as you left it.
> — posted in-app via a login-screen note and any household chat.

## 8. Budgets & alerts

- **LLM spend:** `LLM_DAILY_TOKEN_BUDGET` (default 50k tokens/user/day) —
  a 429 with a friendly message; usage visible in Settings → LLM providers.
  Set the default to whatever a month costs less than one coffee.
- **5xx spikes:** Netlify function log-based alert (free tier): Site
  functions → enable log drain, alert on `Merge failed` / `Household failed`
  repeats. The routes redact connection strings before logging.
- **CI:** GitHub Actions runs typecheck, lint, the 29 pure tests, the DB
  suites (postgres service), and the migration drift check on every push.
  A red CI on `main` = treat as down, not as noise.

## 9. Known limits (honesty section)

- Rate limiting is per-Netlify-instance (in-memory) until Upstash is wired.
- `pg_dump` artifacts live in GitHub (30 days) — for off-GitHub copies,
  periodically download or push to object storage yourself.
- The SW caches the app shell only; data views need the store, which needs
  at least one successful online session per device (P2-10 mirror).
