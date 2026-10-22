export class BillingRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'BillingRequestError'
  }
}

export async function readBillingResponse<T>(
  response: Response,
  fallback: string,
): Promise<T> {
  let body: unknown
  try {
    body = JSON.parse(await response.text())
  } catch {
    // A proxy or an unhandled server error can return text/HTML. Do not expose
    // its JSON.parse error (or HTML body) as the customer's billing message.
    throw new BillingRequestError(fallback, response.status)
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : fallback
    throw new BillingRequestError(message, response.status)
  }
  if (typeof body !== 'object' || body === null)
    throw new BillingRequestError(fallback, response.status)
  return body as T
}
