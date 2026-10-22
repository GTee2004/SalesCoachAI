import { and, asc, eq, isNull } from 'drizzle-orm'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { db } from '#/db'
import { practiceSessions, practiceSessionTurns } from '#/db/schema'
import { env } from '#/env'
import { getRuntimePractice } from '#/lib/server/practice-domain'
import {
  buyerPrompt,
  checkInLine,
  hangUpLine,
  openingLine,
  repairLine,
} from '#/lib/server/prompts/buyer'
import { transcriptionTerms } from '#/lib/practice/offering'
import {
  isUuid,
  json,
  readJson,
  requireSameOrigin,
  requirePracticeUser,
} from '#/lib/server/http'
import {
  SessionOperationBusyError,
  withSessionOperation,
} from '#/lib/server/practice-sessions'
import {
  endVoiceSession,
  getVoiceSession,
  provisionVoiceSession,
} from '#/lib/server/voice-backend'
import { signVoiceToken } from '#/lib/server/voice-token'
import { reconcileVoiceSessions } from '#/lib/server/voice-session-lifecycle'
import {
  releasePracticeReservation,
  reservePracticeCredits,
} from '#/lib/server/billing/credits'
import { isAdmin } from '#/lib/auth/roles'
import {
  DEFAULT_TTS_FALLBACKS,
  DEFAULT_TTS_PROVIDER,
  micTypeSchema,
  ttsProviderSchema,
} from '#/lib/voice/contracts'

const startSchema = z.object({
  // Honoured for admins only; everyone else gets the default provider.
  ttsProvider: ttsProviderSchema.optional(),
  // Sent only when the voice backend uses it, and absent from older clients.
  micType: micTypeSchema.optional(),
})

export const Route = createFileRoute('/api/practice/sessions/$id/start')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!isUuid(params.id))
          return json({ error: 'Session not found' }, { status: 404 })
        requireSameOrigin(request)
        const user = await requirePracticeUser(request)
        const parsed = startSchema.safeParse(await readJson(request))
        if (!parsed.success)
          return json({ error: 'Invalid voice settings' }, { status: 400 })
        // An admin's explicit choice is never swapped for another provider:
        // they pick one to compare it.
        const adminChoice = isAdmin(user) ? parsed.data.ttsProvider : undefined
        let ttsProvider = adminChoice ?? DEFAULT_TTS_PROVIDER
        const ttsFallbacks = adminChoice ? [] : DEFAULT_TTS_FALLBACKS
        const ownedSession = await db.query.practiceSessions.findFirst({
          columns: { id: true },
          where: and(
            eq(practiceSessions.id, params.id),
            eq(practiceSessions.userId, user.id),
            eq(practiceSessions.workspaceId, user.workspaceId),
            isNull(practiceSessions.deletedAt),
          ),
        })

        if (!ownedSession) {
          return json({ error: 'Session not found' }, { status: 404 })
        }
        try {
          await reconcileVoiceSessions(params.id, getVoiceSession)
          const response = await withSessionOperation(params.id, async () => {
            const current = await db.query.practiceSessions.findFirst({
              where: and(
                eq(practiceSessions.id, params.id),
                eq(practiceSessions.userId, user.id),
                eq(practiceSessions.workspaceId, user.workspaceId),
                isNull(practiceSessions.deletedAt),
              ),
            })
            if (!current)
              return json({ error: 'Session not found' }, { status: 404 })
            if (!['created', 'in_progress'].includes(current.status))
              return json({ error: 'Session cannot start' }, { status: 409 })
            const runtime = await getRuntimePractice(current.practiceId, {
              userId: current.userId,
              workspaceId: current.workspaceId,
            })
            if (
              !runtime ||
              (current.status === 'created' &&
                runtime.practice.status !== 'published')
            )
              return json({ error: 'Practice unavailable' }, { status: 404 })
            // Stop the old attempt before reading its final transcript. Claim
            // the new generation before provisioning so late old events are fenced.
            if (current.status === 'in_progress')
              await endVoiceSession(current.id, 'reconnected')
            const attemptId = crypto.randomUUID()
            const previousTurns = await db
              .select({
                sequence: practiceSessionTurns.sequence,
                speaker: practiceSessionTurns.speaker,
                text: practiceSessionTurns.text,
              })
              .from(practiceSessionTurns)
              .where(eq(practiceSessionTurns.sessionId, current.id))
              .orderBy(asc(practiceSessionTurns.sequence))
            let creditBudget: Awaited<ReturnType<typeof reservePracticeCredits>>
            try {
              creditBudget = await reservePracticeCredits({
                workspaceId: current.workspaceId,
                userId: current.userId,
                sessionId: current.id,
                attemptId,
              })
            } catch (error) {
              // Billing refusals (no minutes left, expired plan, no seat) are
              // written for learners, so `learnerMessage` opts them into the
              // UI. The client shows nothing else from a failed start.
              if (error instanceof Response && error.status < 500)
                return json(
                  {
                    error: 'Practice credits unavailable',
                    learnerMessage: await error.text(),
                  },
                  { status: error.status },
                )
              throw error
            }
            let voiceConnection = {
              attemptId,
              status: 'connecting',
              sequence: 0,
              leaseUntil: new Date(Date.now() + 300_000).toISOString(),
              reconnectSeconds: 60,
            }
            try {
              await db
                .update(practiceSessions)
                .set({
                  status: 'in_progress',
                  startedAt: current.startedAt ?? new Date(),
                  runtimeMetadata: {
                    ...current.runtimeMetadata,
                    voiceConnection,
                  },
                })
                .where(eq(practiceSessions.id, current.id))
            } catch (error) {
              await releasePracticeReservation({
                sessionId: current.id,
                attemptId,
              })
              throw error
            }
            const registrationExpiresAt = new Date(Date.now() + 5 * 60_000)
            const base = env.VOICE_BACKEND_PUBLIC_URL.replace(/\/$/, '')
            try {
              const provisioned = await provisionVoiceSession({
                sessionId: current.id,
                attemptId,
                userId: user.id,
                ttsProvider,
                ttsFallbacks,
                buyerGender: runtime.config.buyer.gender,
                micType: parsed.data.micType,
                expiresAt: registrationExpiresAt.toISOString(),
                nextSequence:
                  Math.max(0, ...previousTurns.map((turn) => turn.sequence)) +
                  1,
                maxDurationSeconds: creditBudget.maxDurationSeconds,
                scenario: {
                  systemPrompt: buyerPrompt(runtime, previousTurns),
                  firstUtterance: previousTurns.length
                    ? ''
                    : openingLine(runtime.config),
                  repairUtterance: repairLine(runtime.config),
                  checkInUtterance: checkInLine(runtime.config),
                  hangUpUtterance: hangUpLine(runtime.config),
                  sttTerms: transcriptionTerms(runtime.offering),
                },
              })
              ttsProvider = provisioned.ttsProvider ?? ttsProvider
              voiceConnection = {
                ...voiceConnection,
                leaseUntil:
                  provisioned.startupExpiresAt ??
                  new Date(Date.now() + 120_000).toISOString(),
                reconnectSeconds: provisioned.reconnectSeconds ?? 60,
              }
            } catch (error) {
              await releasePracticeReservation({
                sessionId: current.id,
                attemptId,
              })
              try {
                await endVoiceSession(current.id, 'provisioning_failed')
              } catch (cleanupError) {
                console.error('Failed provisioning cleanup', {
                  sessionId: current.id,
                  error: cleanupError,
                })
              }
              await db
                .update(practiceSessions)
                .set({
                  runtimeMetadata: {
                    ...current.runtimeMetadata,
                    voiceConnection: {
                      ...voiceConnection,
                      status: 'interrupted',
                      reason: 'provisioning_failed',
                      resumeUntil: new Date(
                        Date.now() + voiceConnection.reconnectSeconds * 1000,
                      ).toISOString(),
                    },
                  },
                })
                .where(
                  and(
                    eq(practiceSessions.id, current.id),
                    eq(practiceSessions.status, 'in_progress'),
                  ),
                )
              console.error('Voice provisioning failed', {
                sessionId: current.id,
                error,
              })
              return json(
                { error: 'Unable to start voice service' },
                { status: 502 },
              )
            }
            const updatedRows = await db
              .update(practiceSessions)
              .set({
                status: 'in_progress',
                startedAt: current.startedAt ?? new Date(),
                runtimeMetadata: {
                  ...(current.runtimeMetadata ?? {}),
                  voiceConnection,
                  ttsProvider,
                  ...(parsed.data.micType && { micType: parsed.data.micType }),
                },
              })
              .where(
                and(
                  eq(practiceSessions.id, current.id),
                  eq(practiceSessions.status, 'in_progress'),
                ),
              )
              .returning()
            if (updatedRows.length === 0) {
              try {
                await endVoiceSession(current.id, 'start_state_changed')
              } catch (error) {
                console.error('Could not clean up provisioned voice session', {
                  sessionId: current.id,
                  error,
                })
              }
              return json({ error: 'Session state changed' }, { status: 409 })
            }
            const updated = updatedRows[0]
            const connection = signVoiceToken(
              {
                sub: user.id,
                sid: current.id,
                aid: attemptId,
                nonce: crypto.randomUUID(),
              },
              env.VOICE_TOKEN_SECRET,
            )
            return json({
              sessionId: current.id,
              attemptId,
              status: updated.status,
              ttsProvider,
              micType: parsed.data.micType,
              startedAt: updated.startedAt?.toISOString() ?? null,
              signalingUrl: `${base}/api/offer`,
              connectionToken: connection.token,
              connectionExpiresAt: new Date(
                connection.expiresAt * 1000,
              ).toISOString(),
            })
          })
          return response
        } catch (error) {
          if (error instanceof SessionOperationBusyError)
            return json(
              { error: 'Session operation already in progress' },
              { status: 409 },
            )
          throw error
        }
      },
    },
  },
})
