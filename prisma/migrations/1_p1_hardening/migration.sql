-- P1 hardening migration (P1-1a, P1-1c, P1-5)
-- Applied by `prisma migrate deploy` during the Netlify build.
--
-- Self-healing: the UPDATEs below make the schema constraints safe even if
-- the optional JS backfill job has not run. No valid session survives this
-- migration (tokens are re-keyed under SHA-256 hashes) — every user signs in
-- again once, which is announced in the release notes.

-- 1. Kill all sessions: the Session table is re-keyed around tokenHash;
--    plaintext tokens from v10.3 must not survive the cutover.
DELETE FROM "Session";

-- 2. Ensure no NULL password hash survives (P1-1a). The constant below is
--    scrypt(salt, random-64-hex) generated at migration-authoring time —
--    nobody knows its preimage, so these accounts can only be reached via
--    the admin reset-link flow. (The optional JS backfill assigns each user
--    a unique unusable hash instead; either satisfies the constraint.)
UPDATE "User" SET "passwordHash" = '1abfe70d3daed21e9a4853f6d517c24a:99f085b85fbc93602beff1d7a9ccde832586922ee92e9d80ab4fdc1bd6b45ef8a4a680953186306f528bf3bb5a4e5307afa7d077e3f68b854241c9bb717778fc'
WHERE "passwordHash" IS NULL;

-- 3. Session table: token -> tokenHash (SHA-256 of the raw cookie token).
ALTER TABLE "Session" DROP CONSTRAINT "Session_pkey",
DROP COLUMN "token",
ADD COLUMN     "tokenHash" TEXT NOT NULL,
ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash");

-- 4. User: passwordHash can never be NULL again (the login bypass root);
--    add per-user timezone (P1-5).
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL,
ADD COLUMN "tz" TEXT;
