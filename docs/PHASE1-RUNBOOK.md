# Phase 1 Runbook — deploy, verify, operate

Phase 1 (v10.4.0-p1) hardened authentication, added migrations/transactions,
fixed the UTC-"today" bug, added a test harness, and removed ~40 dead
dependencies. **All users are logged out exactly once** by the Session table
migration — mention it before you deploy.

Ops substrate: **Netlify** (build + hosting), **GitHub** (code), **Neon**
(DB, console access only). Local dev box: node + bash only — that's fine,
everything heavy runs in the Netlify build.

---

## 1. Deploy checklist (do once, in this order)

1. **Back up first.** Neon console → your project → create a branch (point-in-time)
   named `pre-p1`. Takes seconds; your rollback story is "revert to this branch".
2. **Set environment variables** (Netlify → Site settings → Environment variables):
   - `LLM_ENCRYPTION_KEY` = output of `openssl rand -base64 32` (NEW, required)
   - `DATABASE_URL` = your existing Neon **pooled** connection string (unchanged)
   - optional: `SIGNUP_INVITE_CODE`, `UPSTASH_REDIS_REST_URL`/`TOKEN` (see `.env.example`)
   - `LLM_KEY_OBFUSCATION_SECRET` may STAY during the first deploy (the
     re-encrypt job needs it to read legacy keys); delete it afterwards.
3. **Push this branch to GitHub** → Netlify builds it. The build command
   (`npm run build`) runs: `typecheck → migrate-safe → next build`.
   - `migrate-safe` detects the existing v10.3 database with no migration
     history and **baselines `0_init` automatically**, then applies
     `1_p1_hardening` (Session → token hashes, `User.tz`, `passwordHash NOT NULL`
     with a self-healing backfill). No manual Neon steps required.
   - First build is where all users get logged out (sessions table recreated).
4. **Migrate the LLM API keys** (one minute, per-DB): log in as admin →
   ```bash
   curl -X POST https://<your-site>.netlify.app/api/admin/maintenance \
     -H 'Content-Type: application/json' \
     -b 'cookies from your browser session' \
     -d '{"job":"reencrypt-llm-keys"}'
   ```
   (DevTools → copy the `__Host-ledger_session` cookie value as the cookie.)
   Response reports `migrated / alreadyV2 / failed`. If `failed` contains rows,
   the old obfuscation secret was non-default — re-run with the correct
   `LLM_KEY_OBFUSCATION_SECRET` still set, then delete that env var.
5. **Delete `LLM_KEY_OBFUSCATION_SECRET`** from Netlify env vars once step 4
   reports zero failures (redeploy not required — env is read at runtime).
6. Optional: enable the GitHub Actions workflow (`.github/workflows/ci.yml`)
   for a second safety net (real-Postgres test suites + schema/migrations
   drift check). No secrets needed — it spins its own postgres.

## 2. What changed, in one breath

- Login can never accept a null/absent password hash; `resetpw` admin action
  removed (use the admin reset-link flow).
- Sessions: tokens stored as SHA-256 hashes; cookie is now
  `__Host-ledger_session` with `Secure`.
- Login/signup/reset/password-change rate limited; unknown usernames and
  wrong passwords are indistinguishable.
- Password change requires the current password (min 8 chars) and logs out
  other devices.
- LLM API keys encrypted with AES-256-GCM (`LLM_ENCRYPTION_KEY`).
- Security headers on every response (CSP report-only for now).
- All multi-step writes (merge capture, backup restore, account delete) are
  transactional — no more partial days on failure.
- "Today" resolves in the user's timezone (Kathmandu mornings land on the
  right day now).
- Migrations are the only schema path; `db push` is gone from the build.
- Test harness: `npm test` (17+ pure tests always; 12 DB suites wherever a
  postgres `DATABASE_URL` exists — CI or a Neon branch).

## 3. Local development (node + bash only)

```bash
npm install --legacy-peer-deps   # needs registry access; otherwise rely on CI/Netlify
npm run typecheck                # tsc --noEmit — clean, keep it that way
npm test                         # DB suites auto-skip without postgres://DATABASE_URL
npm run dev                      # http://localhost:3000
```

No local DB needed: point `DATABASE_URL` at a **Neon branch** (create it in
the Neon console) if you want DB-backed tests or dev data locally.

## 4. Schema changes after Phase 1 (Phase 2+ recipe)

```bash
# 1. edit prisma/schema.prisma
npx prisma migrate dev --name p2_whatever   # against a Neon branch URL
# 2. review the generated SQL in prisma/migrations/*
# 3. commit — the next Netlify deploy applies it via migrate deploy
```

Never edit shipped migrations. Rollback = restore the `pre-p1` Neon branch.

## 5. Emergency procedures

- **Deploy fails at migrate step** → read the Netlify build log's
  `[migrate-safe]` lines. Worst case: point `DATABASE_URL` at the `pre-p1`
  branch, fix forward from there.
- **"key unreadable — re-enter"** in LLM settings → `LLM_ENCRYPTION_KEY`
  changed or lost. Re-enter keys manually, or restore the old key value.
- **Someone is hammering login** → per-IP+username limiting is active
  (5/15min). For serious abuse add Upstash Redis REST env vars to share
  counters across all Netlify instances.
- **Need to force everyone to re-login** → Admin panel → Force logout (kick).
