-- P2 tool-completeness migration
-- 1. Tasks may now be unassigned (no goal) — board/matrix/inbox can create
--    free-standing tasks. Existing FK stays; it just becomes nullable.
ALTER TABLE "Task" ALTER COLUMN "goalId" DROP NOT NULL;

-- 2. Habits can be archived (hidden but kept) instead of being immortal.
ALTER TABLE "Habit" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
