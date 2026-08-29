-- P2-5 indexes migration (the quiet performance WP)
-- Three composite indexes for the canonical aggregate scans. Each mirrors
-- exactly what `prisma migrate dev` would generate for the @@index blocks in
-- schema.prisma, so the CI drift check stays green.
-- (Plain CREATE INDEX — the tables are small at solo scale; CONCURRENTLY
-- cannot run inside the migrate transaction anyway.)

-- Per-goal hour rolls: week view, review, derivations, household.
CREATE INDEX "Activity_userId_goalId_date_idx" ON "Activity"("userId", "goalId", "date");

-- The consistency heatmap scans by habit, not by day.
CREATE INDEX "DayHabit_userId_habitId_date_idx" ON "DayHabit"("userId", "habitId", "date");

-- DayMetric was entirely unindexed before.
CREATE INDEX "DayMetric_userId_metricId_date_idx" ON "DayMetric"("userId", "metricId", "date");
