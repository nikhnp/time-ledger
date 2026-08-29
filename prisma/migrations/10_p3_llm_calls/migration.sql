-- P3-2: one row per LLM invocation. Powers the per-user daily token budget
-- (LLM_DAILY_TOKEN_BUDGET, default 50k) and the usage panel in Settings.
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "route" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- The budget counter scans one user's calls for today; usage panel too.
CREATE INDEX "LlmCall_userId_createdAt_idx" ON "LlmCall"("userId" ASC, "createdAt" ASC);

-- Add foreign key + index back to User (nullable — system-level calls)
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
