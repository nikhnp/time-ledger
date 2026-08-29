-- P2-3 edit/delete + P2-4 close-the-day migration
-- 1. Activity.updatedAt: set only by client edits (PATCH /api/activities/[id]).
--    createdAt stays untouched so provenance is preserved.
ALTER TABLE "Activity" ADD COLUMN "updatedAt" TIMESTAMP(3);

-- 2. Day.plan: tomorrow's plan (JSON array of {goalId, hours, note}) written
--    by PATCH /api/days/[date]. Surfaced as the next-morning
--    "Tonight you planned…" banner — a suggestion, never an auto-write.
ALTER TABLE "Day" ADD COLUMN "plan" TEXT;
