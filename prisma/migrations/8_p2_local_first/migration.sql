-- P2-10 local-first migration
-- Client-side idempotency keys for the offline outbox: a replayed capture
-- upserts on (userId, clientId) instead of appending a duplicate row. The
-- columns are nullable — every existing write path stays valid; replays and
-- new offline captures stamp a client cuid.
ALTER TABLE "Activity" ADD COLUMN "clientId" TEXT;
ALTER TABLE "Note" ADD COLUMN "clientId" TEXT;

CREATE UNIQUE INDEX "Activity_userId_clientId_key" ON "Activity"("userId", "clientId");
CREATE UNIQUE INDEX "Note_userId_clientId_key" ON "Note"("userId", "clientId");
