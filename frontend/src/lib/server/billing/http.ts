import { json } from '#/lib/server/http'

export async function billingErrorResponse(error: unknown, fallback: string) {
  if (error instanceof Response) {
    const text = await error.text()
    let message = text || fallback
    if (error.headers.get('content-type')?.includes('application/json')) {
      try {
        const body = JSON.parse(text) as { error?: unknown }
        message = typeof body.error === 'string' ? body.error : fallback
      } catch {
        message = fallback
      }
    }
    return json({ error: message }, { status: error.status })
  }
  console.error('[Billing] request failed', error)
  return json({ error: fallback }, { status: 500 })
}
