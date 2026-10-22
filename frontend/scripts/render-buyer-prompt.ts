import { readFileSync } from 'node:fs'
import { z } from 'zod'
import {
  BUYER_PROMPT_VERSION,
  buyerPrompt,
} from '../src/lib/server/prompts/buyer'
import type { BuyerPromptInput } from '../src/lib/server/prompts/buyer'

// Draft evaluation fixtures may omit persona fields that the builder only
// serializes (e.g. gender/urgency). Validate everything it actually dereferences;
// do not invent those missing facts just to create a complete database record.
const runtimeSchema = z.object({
  practice: z.object({
    type: z.enum(['cold_call', 'warm_call']),
    locale: z.string().min(1),
  }),
  config: z
    .object({
      kind: z.enum(['cold_call', 'warm_call']),
      buyer: z
        .object({
          name: z.string().min(1),
          addressTerm: z.enum(['anh', 'chị', 'cô', 'chú', 'bác', 'em']),
          emotionalState: z.enum([
            'friendly',
            'neutral',
            'guarded',
            'impatient',
            'hostile',
          ]),
          voice: z
            .object({ speakingStyle: z.string().optional() })
            .passthrough()
            .optional(),
        })
        .passthrough(),
      privateBackground: z.string(),
      recollection: z.string(),
      sinceLastContact: z.string().optional(),
      hiddenInsights: z.array(z.record(z.string(), z.unknown())),
      objections: z.array(z.record(z.string(), z.unknown())),
      behaviorRules: z.array(z.string()),
      openingLine: z.string().min(1).optional(),
      hangUpGuidance: z.string().optional(),
    })
    .passthrough(),
  learnerBrief: z
    .object({ previousInteractions: z.array(z.unknown()).optional() })
    .passthrough(),
  offering: z.record(z.string(), z.unknown()),
})

const fixtures = z
  .array(
    z.object({
      case_id: z.string().min(1),
      runtime: runtimeSchema,
      previous_turns: z.array(
        z.object({ speaker: z.string(), text: z.string() }),
      ),
    }),
  )
  .parse(JSON.parse(readFileSync(0, 'utf8')))

const rendered = fixtures.map(({ case_id, runtime, previous_turns }) => {
  if (runtime.practice.type !== runtime.config.kind)
    throw new Error(`${case_id}: practice type and config kind disagree`)
  if (runtime.config.kind === 'warm_call' && !runtime.config.sinceLastContact)
    throw new Error(`${case_id}: warm call needs sinceLastContact`)
  return {
    case_id,
    prompt_version: BUYER_PROMPT_VERSION,
    // Boundary between intentionally incomplete synthetic fixtures and the
    // production type. No prompt text is copied or reimplemented here.
    system_prompt: buyerPrompt(runtime as BuyerPromptInput, previous_turns),
  }
})
process.stdout.write(JSON.stringify(rendered))
