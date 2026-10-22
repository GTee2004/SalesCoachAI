import { and, eq } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { db } from '#/db'
import { practiceSessions, practiceSessionTurns } from '#/db/schema'
import { env } from '#/env'
import { json } from '#/lib/server/http'
import { safeSecretEqual } from '#/lib/server/voice-token'
import {
  persistConnectionEvent,
  reconcileVoiceSessions,
} from '#/lib/server/voice-session-lifecycle'
import { getVoiceSession } from '#/lib/server/voice-backend'
import {
  MAX_ATTEMPT_ACTIVE_SECONDS,
  settlePracticeCredits,
} from '#/lib/server/billing/credits'
import {
  parseServiceUsage,
  recordServiceUsage,
} from '#/lib/server/service-usage'
import { evaluatePracticeSessionUnlocked } from '#/lib/server/practice-evaluation'
import {
  SessionOperationBusyError,
  withSessionOperation,
} from '#/lib/server/practice-sessions'
import { voiceEventSchema } from '#/lib/voice/contracts'

const transcriptPayload = z.object({
  utteranceId: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(8000),
  interrupted: z.boolean().optional(),
  playbackStatus: z.string().optional(),
  latency: z.unknown().optional(),
})

/** Calls the voice backend ends by itself that still count as finished practice. */
const completedEndReasons: Partial<
  Record<string, 'time_limit' | 'learner_idle'>
> = {
  credit_limit: 'time_limit',
  // The backend's hard cap on call length, in case it stops the call first.
  duration_limit: 'time_limit',
  learner_idle: 'learner_idle',
}

const replyMs = z.number().int().min(0).max(600_000)
/** How long the AI buyer took to start a reply, per pipecat stage. */
const replyLatency = z.object({
  totalMs: replyMs,
  stages: z
    .record(z.string().min(1).max(64), replyMs)
    .refine((stages) => Object.keys(stages).length <= 32),
})

export const Route = createFileRoute('/api/internal/voice/events')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get('authorization')
        const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null
        if (!safeSecretEqual(bearer, env.VOICE_EVENT_INGEST_KEY))
          return json({ error: 'Unauthorized' }, { status: 401 })
        const contentLength = Number(request.headers.get('content-length') ?? 0)
        if (contentLength > 128_000)
          return json({ error: 'Payload too large' }, { status: 413 })
        const body = await request.text()
        if (new TextEncoder().encode(body).byteLength > 128_000)
          return json({ error: 'Payload too large' }, { status: 413 })
        let raw: unknown
        try {
          raw = JSON.parse(body)
        } catch {
          return json({ error: 'Invalid JSON' }, { status: 400 })
        }
        const parsed = voiceEventSchema.safeParse(raw)
        if (!parsed.success)
          return json({ error: 'Invalid event' }, { status: 400 })
        const event = parsed.data
        if (event.type === 'session.reconcile') {
          // Buffered maintenance ticks cannot expire a recovered connection
          // before the current lease has been delivered.
          if (Date.now() - Date.parse(event.occurredAt) < 15_000)
            await reconcileVoiceSessions(undefined, getVoiceSession)
          return json({ accepted: true })
        }
        const payload =
          event.type === 'transcript.final'
            ? transcriptPayload.safeParse(event.payload)
            : null
        const current = await db.query.practiceSessions.findFirst({
          where: eq(practiceSessions.id, event.sessionId),
        })
        if (!current)
          return json({ error: 'Session not found' }, { status: 404 })
        if (payload && !payload.success)
          return json({ error: 'Invalid transcript' }, { status: 400 })
        if (event.type === 'usage.recorded') {
          const activeSeconds = z
            .object({
              // Past 15 minutes only when a call got back time lost to an outage.
              activeSeconds: z
                .number()
                .int()
                .min(0)
                .max(MAX_ATTEMPT_ACTIVE_SECONDS),
              // Older voice backends omit it and charge all active time.
              outageSeconds: z
                .number()
                .int()
                .min(0)
                .max(MAX_ATTEMPT_ACTIVE_SECONDS)
                .optional(),
            })
            .safeParse(event.payload)
          if (!activeSeconds.success || !event.attemptId)
            return json({ error: 'Invalid practice usage' }, { status: 400 })
          await settlePracticeCredits({
            sessionId: event.sessionId,
            attemptId: event.attemptId,
            activeSeconds: activeSeconds.data.activeSeconds,
            waivedSeconds: activeSeconds.data.outageSeconds,
          })
          // Providers bill deleted sessions too.
          await recordServiceUsage({
            sessionId: event.sessionId,
            usageKey: event.attemptId,
            source: 'conversation',
            items: parseServiceUsage(event.payload.services),
          })
          return json({ accepted: true, discarded: Boolean(current.deletedAt) })
        }
        if (current.deletedAt)
          return json({
            accepted: true,
            discarded: true,
            reason: 'session_deleted',
          })
        if (payload?.success) {
          const speaker = payload.data.role === 'user' ? 'salesperson' : 'buyer'
          // Diagnostics only: a malformed latency must never cost the transcript.
          const latency =
            speaker === 'buyer'
              ? replyLatency.safeParse(payload.data.latency)
              : null
          const outcome = await db.transaction(async (tx) => {
            const owner = (
              await tx
                .select()
                .from(practiceSessions)
                .where(eq(practiceSessions.id, event.sessionId))
                .for('update')
            ).at(0)
            if (!owner) return 'missing' as const
            if (owner.deletedAt) return 'deleted' as const
            const connection = owner.runtimeMetadata?.voiceConnection as
              { attemptId?: string } | undefined
            if (connection && connection.attemptId !== event.attemptId) return
            const inserted = await tx
              .insert(practiceSessionTurns)
              .values({
                sessionId: event.sessionId,
                sequence: event.sequence,
                speaker,
                text: payload.data.text,
                metadata: {
                  utteranceId: payload.data.utteranceId,
                  interrupted: payload.data.interrupted ?? false,
                  playbackStatus: payload.data.playbackStatus ?? 'unknown',
                  ...(latency?.success ? { latency: latency.data } : {}),
                },
              })
              .onConflictDoNothing()
              .returning({ id: practiceSessionTurns.id })
            if (inserted.length === 0) {
              const existing = await tx.query.practiceSessionTurns.findFirst({
                where: and(
                  eq(practiceSessionTurns.sessionId, event.sessionId),
                  eq(practiceSessionTurns.sequence, event.sequence),
                ),
              })
              if (
                !existing ||
                existing.speaker !== speaker ||
                existing.text !== payload.data.text ||
                existing.metadata?.utteranceId !== payload.data.utteranceId
              )
                throw new Response('Conflicting transcript sequence', {
                  status: 409,
                })
            }
          })
          if (outcome === 'missing')
            return json({ error: 'Session not found' }, { status: 404 })
          if (outcome === 'deleted')
            return json({
              accepted: true,
              discarded: true,
              reason: 'session_deleted',
            })
        }
        if (event.type === 'session.state' || event.type === 'session.lease') {
          const outcome = await persistConnectionEvent(event)
          if (outcome === 'missing')
            return json({ error: 'Session not found' }, { status: 404 })
          if (outcome === 'deleted')
            return json({
              accepted: true,
              discarded: true,
              reason: 'session_deleted',
            })
          const ended = z
            .object({ status: z.string(), reason: z.string().optional() })
            .safeParse(event.payload)
          const endReason =
            event.type === 'session.state' &&
            ended.success &&
            ended.data.status === 'ended'
              ? completedEndReasons[ended.data.reason ?? '']
              : undefined
          if (endReason) {
            const completed = await db
              .update(practiceSessions)
              .set({
                status: 'completed',
                endReason,
                completedAt: new Date(),
              })
              .where(
                and(
                  eq(practiceSessions.id, event.sessionId),
                  eq(practiceSessions.status, 'in_progress'),
                ),
              )
              .returning({ id: practiceSessions.id })
            // Evaluation takes far longer than the voice backend waits for an
            // ingest response, and it delivers that session's events in order,
            // so answer now and evaluate in the background. Holding the session
            // operation lock meanwhile reports the feedback as pending; it is
            // only tried, so it can never wait on an End that waits on ingestion.
            if (completed.length)
              void withSessionOperation(event.sessionId, () =>
                evaluatePracticeSessionUnlocked(event.sessionId),
              ).catch((error: unknown) => {
                // A concurrent End evaluates the session itself.
                if (error instanceof SessionOperationBusyError) return
                console.error(
                  'Practice evaluation failed after the call ended',
                  {
                    sessionId: event.sessionId,
                    endReason,
                    error,
                  },
                )
              })
          }
        }
        return json({ accepted: true })
      },
    },
  },
})
