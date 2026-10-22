import { env } from '#/env'
import { createSepayApi } from './sepay-client'

export const { findSepayOrderByInvoice, cancelSepayOrder } = createSepayApi({
  merchantId: env.SEPAY_MERCHANT_ID,
  secretKey: env.SEPAY_SECRET_KEY,
  environment: env.SEPAY_ENV,
})
