// Run once per minute from cron or a hosting scheduler. No browser cookies.
const secret = process.env.BILLING_SWEEP_SECRET?.trim()
const origin =
  process.env.BILLING_PUBLIC_BASE_URL || process.env.BETTER_AUTH_URL
if (!secret || secret.length < 32 || !origin) {
  console.error(
    'Set BILLING_SWEEP_SECRET (32+ chars) and BILLING_PUBLIC_BASE_URL or BETTER_AUTH_URL.',
  )
  process.exitCode = 1
} else {
  try {
    const endpoint = new URL('/api/internal/billing/expire-orders', origin)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      redirect: 'error',
      signal: AbortSignal.timeout(90_000),
    })
    if (!response.ok)
      throw new Error(`Billing sweep returned HTTP ${response.status}`)
    console.info(JSON.stringify(await response.json()))
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Billing sweep failed',
    )
    process.exitCode = 1
  }
}
