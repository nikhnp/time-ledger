-- P2-2 pursuits migration
-- Hobbies become first-class: a Goal with kind='hobby' gets everything goals
-- already have (color, weekly target hours, tasks, activity logging) for free,
-- because Activity.goalId already points at them. Zero new joins; existing
-- rows keep their meaning (kind defaults to 'goal', migration is invisible).
ALTER TABLE "Goal" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'goal';
