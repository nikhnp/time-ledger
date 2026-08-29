-- P3-1 weekly review: new users get the review tool enabled by default.
-- Metadata-only SET DEFAULT (instant, no rewrite — same pattern as
-- 3_p2_presets). Existing users' saved dockConfig is never touched; they
-- enable Review with one tap in Settings → Tools.
ALTER TABLE "User" ALTER COLUMN "dockConfig" SET DEFAULT '{"enabled":["habits","board","goals","inbox","notes","review"],"keepInDock":["habits"]}";
