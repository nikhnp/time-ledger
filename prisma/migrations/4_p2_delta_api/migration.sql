-- P2-1 delta API migration
-- 1. ChangeLog: append-only per-user change feed. Every ledger mutation
--    appends rows here in the same transaction as the write, so
--    /api/ledger?since=<cursor> can return just the delta and mutations can
--    respond with a small per-entity patch instead of the full ledger.
CREATE TABLE "ChangeLog" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityDate" TEXT,
    "op" TEXT NOT NULL DEFAULT 'upsert',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- Read path is always (userId, id > cursor); pruning is per user too.
-- Also serves the FK cascade when a user (and their feed) is deleted.
CREATE INDEX "ChangeLog_userId_id_idx" ON "ChangeLog"("userId" ASC, "id" ASC);

-- 2. User.syncWatermark: highest ChangeLog id pruned for this user. A delta
--    client whose cursor is below the watermark may have missed pruned
--    changes -> /api/ledger?since= responds with a full ledger for it.
--    Metadata-only ADD COLUMN with DEFAULT (no table rewrite on Postgres 11+).
ALTER TABLE "User" ADD COLUMN "syncWatermark" INTEGER NOT NULL DEFAULT 0;
