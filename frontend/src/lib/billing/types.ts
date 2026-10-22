export type BillingSummary = {
  workspaceId: string
  personalWorkspaceId: string | null
  // Company workspaces the user owns; filled only on a personal workspace.
  ownedCompanyWorkspaces: Array<{
    id: string
    name: string
    status: 'ready' | 'pending_subscription'
  }>
  paymentVerificationWarning: string | null
  workspace: {
    id: string
    name: string
    kind: 'personal' | 'company'
    status: 'ready' | 'pending_subscription'
    role: string
  }
  plan: 'free' | 'pro' | 'business'
  interval: 'monthly' | 'yearly' | null
  subscriptionStatus: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  pendingPlan: 'pro' | 'business' | null
  pendingInterval: 'monthly' | 'yearly' | null
  pendingSeatQuantity: number | null
  seatQuantity: number
  // Seats taken by members or held by pending invitations; company only.
  seatUsage: { used: number; pendingInvitations: number } | null
  hasSeat: boolean
  members: Array<{
    userId: string
    name: string
    email: string
    role: string
    paidSeat: boolean
  }>
  minutes: { included: number; topup: number; refreshAt: string | null }
  recentOrders: Array<{
    invoice: string
    productCode: string
    amountVnd: number
    discountVnd: number
    couponCode: string | null
    status: string
    createdAt: string
    verificationWarning: string | null
  }>
}
