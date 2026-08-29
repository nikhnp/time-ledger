/* P3-2: shared zod schemas — the single source of truth for LLM JSON.
 * zod 4 exports schemas to JSON Schema natively (z.toJSONSchema), so the
 * SAME schema builds the provider-native structured-output request AND
 * validates the response. JSON.parse-ing model output outside generateJson
 * is a lint-banned pattern from here on. */

import { z } from 'zod'

export const QuestionSetSchema = z
  .object({
    questions: z.array(z.string().min(1).max(200)).min(1).max(5),
  })
  .describe('Reflection questions for a personal time-tracking app')

export type QuestionSet = z.infer<typeof QuestionSetSchema>

export const RecommendationListSchema = z
  .object({
    recommendations: z
      .array(
        z.object({
          kind: z.enum(['activity', 'habit', 'note', 'checkin', 'screen']),
          text: z.string().min(1).max(140),
          goalId: z.string().max(60).optional(),
        }),
      )
      .min(1)
      .max(4),
  })
  .describe('Ideas for what to record next in a time-tracking journal')

export type RecommendationList = z.infer<typeof RecommendationListSchema>
