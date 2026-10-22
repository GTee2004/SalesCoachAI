import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, LoaderCircle, Plus } from 'lucide-react'
import { CouponField, Price } from '#/components/billing/coupon-field'
import { ManageSeatsModal } from '#/components/billing/manage-seats-modal'
import { SwitchIntervalModal } from '#/components/billing/switch-interval-modal'
import { Button } from '#/components/ui/button'
import { ButtonLink } from '#/components/ui/button-link'
import { NativeSelect } from '#/components/ui/native-select'
import { Input } from '#/components/ui/input'
import { authClient } from '#/lib/auth/client'
import {
  BUSINESS_MIN_SEATS,
  subscriptions,
  topupPacks,
} from '#/lib/billing/catalog'
import {
  checkoutReturnMessages,
  readCheckoutOutcome,
} from '#/lib/billing/checkout-return'
import { BillingRequestError, readBillingResponse } from '#/lib/billing/http'

import type { CheckoutOutcome } from '#/lib/billing/checkout-return'
import type { PublicCoupon } from '#/lib/billing/coupons'
import type { BillingSummary } from '#/lib/billing/types'

export const Route = createFileRoute('/billing')({
  // Params are read from window.location in BillingPage; pass them through
  // untouched so typed <Link search> works without reshaping values.
  validateSearch: (search: Record<string, unknown>) => search,
  component: BillingPage,
})

const money = new Intl.NumberFormat('vi-VN')
const packLabels: Record<string, string> = {
  topup_15: '15 phút',
  topup_75: '75 phút',
  topup_150: '150 phút',
  topup_300: '300 phút',
}
const productLabels: Record<string, string> = {
  pro_monthly: 'Gói Pro · hàng tháng',
  pro_yearly: 'Gói Pro · hàng năm',
  business_monthly: 'Gói Business · hàng tháng',
  business_yearly: 'Gói Business · hàng năm',
  business_seats_monthly: 'Thêm suất Business · hàng tháng',
  business_seats_yearly: 'Thêm suất Business · hàng năm',
  ...Object.fromEntries(
    topupPacks.map((pack) => [pack.code, `Mua thêm ${pack.minutes} phút`]),
  ),
}
const orderStatusLabels: Record<string, string> = {
  paid: 'Đã thanh toán',
  pending: 'Đang chờ xác nhận',
  expired: 'Phiên thanh toán đã hết hạn',
  cancelled: 'Đơn thanh toán đã hủy',
  failed: 'Cần kiểm tra đơn hàng',
  void: 'Giao dịch cần được đối soát',
  review: 'Đã nhận tiền; đơn cần được đối soát',
}

async function loadBillingSummary(invoice = '') {
  const query = invoice ? `?${new URLSearchParams({ order: invoice })}` : ''
  return readBillingResponse<BillingSummary>(
    await fetch(`/api/billing/summary${query}`),
    'Chưa thể tải thông tin thanh toán. Vui lòng thử lại sau.',
  )
}

function BillingPage() {
  const { user } = Route.useRouteContext()
  const router = useRouter()
  // Read from the router, not window.location, so in-page links that switch
  // between the Pro and Business forms update the view and Back undoes them.
  const { plan } = Route.useSearch()
  const requestedPlan = typeof plan === 'string' ? plan : ''
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [loading, setLoading] = useState(Boolean(user))
  const [busy, setBusy] = useState(false)
  const [checkingPayment, setCheckingPayment] = useState(false)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [seatQuantity, setSeatQuantity] = useState(2)
  const [topupCode, setTopupCode] = useState('topup_15')
  const [topupRecipientId, setTopupRecipientId] = useState('')
  const [seatsOpen, setSeatsOpen] = useState(false)
  const [intervalOpen, setIntervalOpen] = useState(false)
  const [requestedInterval, setRequestedInterval] = useState<
    'monthly' | 'yearly'
  >('monthly')
  const [coupon, setCoupon] = useState<PublicCoupon | null>(null)
  const [orderInvoice, setOrderInvoice] = useState('')
  const [checkoutOutcome, setCheckoutOutcome] =
    useState<CheckoutOutcome | null>(null)
  const [cancellingInvoice, setCancellingInvoice] = useState('')
  const [orderNotice, setOrderNotice] = useState<{
    invoice: string
    message: string
  } | null>(null)

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    setRequestedInterval(
      query.get('interval') === 'yearly' ? 'yearly' : 'monthly',
    )
    setSeatQuantity(Math.max(2, Number(query.get('seats')) || 2))
    setTopupCode(query.get('topup') ?? 'topup_15')
    setOrderInvoice(query.get('order') ?? '')
    setCheckoutOutcome(readCheckoutOutcome(query.get('payment')))
    if (!user) return
    loadBillingSummary(query.get('order') ?? '')
      .then((value) => {
        setSummary(value)
        setRefreshError('')
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Chưa thể tải thông tin thanh toán.',
        )
      })
      .finally(() => setLoading(false))
  }, [user])

  const hasPendingPayment = Boolean(
    summary?.workspace.role === 'owner' &&
    summary.recentOrders.some((order) =>
      ['pending', 'expired'].includes(order.status),
    ),
  )

  useEffect(() => {
    if (!hasPendingPayment) return
    let stopped = false
    let inFlight = false
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || inFlight) return
      inFlight = true
      void loadBillingSummary(orderInvoice)
        .then((value) => {
          if (!stopped) {
            setSummary(value)
            setRefreshError('')
          }
        })
        .catch(() => {
          if (!stopped)
            setRefreshError(
              'Chưa thể cập nhật danh sách đơn hàng. Trạng thái bên dưới là kết quả kiểm tra gần nhất; trang sẽ thử lại.',
            )
        })
        .finally(() => {
          inFlight = false
        })
    }, 15_000)
    return () => {
      stopped = true
      window.clearInterval(interval)
    }
  }, [orderInvoice, hasPendingPayment])

  async function checkPayment() {
    if (checkingPayment) return
    setCheckingPayment(true)
    setError('')
    try {
      setSummary(await loadBillingSummary(orderInvoice))
      setRefreshError('')
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Chưa thể kiểm tra thanh toán.',
      )
    } finally {
      setCheckingPayment(false)
    }
  }

  async function cancelOrder(invoice: string) {
    if (!summary || busy || cancellingInvoice) return
    setBusy(true)
    setCancellingInvoice(invoice)
    setError('')
    setOrderNotice(null)
    try {
      const result = await readBillingResponse<{ status: string }>(
        await fetch('/api/billing/orders/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId: summary.workspaceId, invoice }),
        }),
        'Chưa thể hủy đơn hàng. Vui lòng kiểm tra lại.',
      )
      setOrderNotice({
        invoice,
        message:
          result.status === 'cancelled'
            ? 'SePay đã xác nhận hủy đơn hàng.'
            : 'Trạng thái đơn đã được cập nhật. Nếu đã trả tiền, vui lòng không thanh toán lại.',
      })
      setSummary(await loadBillingSummary(orderInvoice))
      setRefreshError('')
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Chưa thể hủy đơn hàng.',
      )
      // A payment can complete while a cancellation request is in flight.
      try {
        setSummary(await loadBillingSummary(orderInvoice))
      } catch {
        /* Keep the cancellation error visible. */
      }
    } finally {
      setBusy(false)
      setCancellingInvoice('')
    }
  }

  const selectedTopup = useMemo(
    () => topupPacks.find((pack) => pack.code === topupCode) ?? topupPacks[0],
    [topupCode],
  )

  async function startCheckout(
    productCode: string,
    seats = 1,
    creditRecipientUserId?: string,
    // Only the buttons on this page show the discounted price. The seat and
    // interval dialogs quote their own amounts, so they never send the coupon.
    withCoupon = false,
  ) {
    if (!summary || busy) return
    const orderType = productCode.startsWith('topup_')
      ? 'topup'
      : 'subscription'
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: summary.workspaceId,
          productCode,
          seatQuantity: seats,
          creditRecipientUserId,
          couponCode:
            withCoupon && coupon?.appliesTo.includes(orderType)
              ? coupon.code
              : undefined,
          expectedSubscriptionPeriodEnd:
            summary.subscriptionStatus === 'active'
              ? summary.currentPeriodEnd
              : null,
          idempotencyKey: crypto.randomUUID(),
        }),
      })
      const result = await readBillingResponse<
        | { action: string; fields: Record<string, string> }
        // A coupon took the order to zero: it is already settled, with no
        // payment page to visit.
        | { free: true; invoice: string }
      >(response, 'Chưa thể tạo thanh toán. Vui lòng thử lại sau.')
      if ('free' in result) {
        window.location.assign(
          `/billing?order=${encodeURIComponent(result.invoice)}&payment=free`,
        )
        return
      }
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = result.action
      for (const [name, value] of Object.entries(result.fields)) {
        const field = document.createElement('input')
        field.type = 'hidden'
        field.name = name
        field.value = value
        form.append(field)
      }
      document.body.append(form)
      form.submit()
    } catch (reason) {
      if (reason instanceof BillingRequestError && reason.status === 409) {
        try {
          setSummary(await loadBillingSummary(orderInvoice))
        } catch {
          /* Keep the checkout error visible. */
        }
      }
      setError(
        reason instanceof Error ? reason.message : 'Chưa thể tạo thanh toán.',
      )
      setBusy(false)
    }
  }

  async function createBusinessWorkspace(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: workspaceName.trim(),
          requestId: crypto.randomUUID(),
        }),
      })
      const result = await readBillingResponse<{ workspaceId: string }>(
        response,
        'Chưa thể tạo không gian làm việc. Vui lòng thử lại sau.',
      )
      const active = await authClient.organization.setActive({
        organizationId: result.workspaceId,
      })
      if (active.error)
        throw new Error(
          'Không gian làm việc đã tạo. Hãy chọn không gian làm việc đó ở menu rồi thử lại.',
        )
      window.location.assign(
        `/billing?plan=business&interval=${requestedInterval}&seats=${seatQuantity}`,
      )
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Chưa thể tạo không gian làm việc.',
      )
      setBusy(false)
    }
  }

  async function switchToPersonalWorkspace() {
    if (!summary?.personalWorkspaceId || busy) return
    setBusy(true)
    setError('')
    const result = await authClient.organization.setActive({
      organizationId: summary.personalWorkspaceId,
    })
    if (result.error) {
      setError('Chưa thể chuyển sang tài khoản cá nhân.')
      setBusy(false)
      return
    }
    window.location.assign(`/billing?plan=pro&interval=${requestedInterval}`)
  }

  async function switchToCompanyWorkspace(organizationId: string) {
    if (busy) return
    setBusy(true)
    setError('')
    const result = await authClient.organization.setActive({ organizationId })
    if (result.error) {
      setError('Chưa thể chuyển sang không gian làm việc công ty.')
      setBusy(false)
      return
    }
    window.location.assign(
      `/billing?plan=business&interval=${requestedInterval}&seats=${seatQuantity}`,
    )
  }

  async function cancelRenewal() {
    if (!summary || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/billing/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: summary.workspaceId }),
      })
      await readBillingResponse(
        response,
        'Chưa thể cập nhật gói. Vui lòng thử lại sau.',
      )
      window.location.reload()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Chưa thể cập nhật gói.',
      )
      setBusy(false)
    }
  }

  const requestedPlanLabel = requestedPlan.toLowerCase()
  // An active company subscription is managed in place; the purchase form is
  // only for a workspace that has no live plan to change.
  const managesActiveBusiness =
    summary?.workspace.kind === 'company' &&
    summary.plan === 'business' &&
    summary.subscriptionStatus === 'active' &&
    summary.interval !== null
  const changeBlockedReason = summary?.pendingPlan
    ? 'Đã có thay đổi được lên lịch cho kỳ tiếp theo. Bạn có thể thay đổi tiếp khi kỳ mới bắt đầu.'
    : hasPendingPayment
      ? 'Đang có đơn chờ thanh toán. Hãy hoàn tất hoặc hủy đơn đó trước khi thay đổi gói.'
      : ''

  return (
    <main className="min-h-screen bg-background font-sans font-normal text-foreground">
      <div className="mx-auto max-w-[1120px] px-5 py-8">
        <Link
          to="/"
          aria-label="SalesCoach AI — Trang chủ"
          className="inline-flex"
        >
          <img
            src="/images/LOGO_salescoachAI.png"
            alt="SalesCoach AI"
            width={180}
            height={60}
            className="h-[60px] w-[180px] object-contain"
          />
        </Link>
        <div className="mt-[22px]">
          <Link
            to="/practice"
            onClick={(event) => {
              // Return to wherever the user came from; fall back to /practice
              // when billing was opened directly (no in-app history).
              if (router.history.canGoBack()) {
                event.preventDefault()
                router.history.back()
              }
            }}
            className="inline-flex items-center gap-2 text-sm font-normal text-brand hover:underline"
          >
            <ArrowLeft className="size-4" /> Quay lại
          </Link>
        </div>
        <header className="mt-6">
          <p className="text-xs font-normal text-brand">
            THANH TOÁN KHÔNG GIAN LÀM VIỆC
          </p>
          <h1 className="mt-2.5 text-[29px] leading-[1.6] font-normal sm:text-[38px]">
            Gói và hạn mức sử dụng
          </h1>
          {summary && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {summary.workspace.kind === 'personal'
                ? 'Tài khoản cá nhân'
                : 'Không gian làm việc công ty'}
              {' · '}
              {summary.workspace.role === 'owner' ? 'Chủ sở hữu' : 'Thành viên'}
            </p>
          )}
        </header>

        {!user ? (
          <section className="mt-7 rounded-lg border border-border bg-background p-6">
            <p className="text-sm text-muted-foreground">
              Đăng nhập để chọn không gian làm việc và hoàn tất thanh toán.
            </p>
            <a
              className="mt-4 inline-flex h-12 items-center rounded-lg bg-primary px-5 text-sm font-normal text-primary-foreground hover:bg-primary-hover"
              href={`/login?callbackUrl=${encodeURIComponent('/billing')}`}
            >
              Đăng nhập
            </a>
          </section>
        ) : loading ? (
          <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Đang tải thông tin
            thanh toán…
          </div>
        ) : summary ? (
          <>
            <section className="mt-7 min-h-[338px] rounded-xl border-0 bg-brand-gradient p-7">
              <p className="text-[13px] text-muted-foreground">
                Không gian làm việc đang thanh toán
              </p>
              <h2 className="mt-1 text-[25px] font-normal">
                {summary.workspace.name}
              </h2>
              <p className="mt-1 text-sm text-foreground">
                Gói {summary.plan.toUpperCase()}
                {summary.subscriptionStatus === 'expired'
                  ? ' · đã hết hạn'
                  : ''}
                {summary.interval
                  ? ` · ${summary.interval === 'monthly' ? 'hàng tháng' : 'hàng năm'}`
                  : ''}
                {summary.workspace.kind === 'company'
                  ? ` · ${summary.seatQuantity} suất`
                  : ''}
              </p>
              <div className="mt-7 grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="text-[13px] text-foreground">
                    Phút hạn mức tháng này
                  </p>
                  <p className="mt-1 text-[32px] font-normal">
                    {summary.minutes.included}
                  </p>
                  {summary.minutes.refreshAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Làm mới{' '}
                      {new Intl.DateTimeFormat('vi-VN', {
                        dateStyle: 'medium',
                        timeZone: 'Asia/Ho_Chi_Minh',
                      }).format(new Date(summary.minutes.refreshAt))}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[13px] text-foreground">
                    Phút mua thêm còn lại
                  </p>
                  <p className="mt-1 text-[32px] font-normal">
                    {summary.minutes.topup}
                  </p>
                </div>
              </div>
              {summary.currentPeriodEnd && (
                <p className="mt-4 text-[13px] text-foreground">
                  {summary.subscriptionStatus === 'expired'
                    ? 'Gói hết hạn vào'
                    : summary.cancelAtPeriodEnd
                      ? 'Gói kết thúc vào'
                      : 'Gói hiện tại có hiệu lực đến'}{' '}
                  {new Intl.DateTimeFormat('vi-VN', {
                    dateStyle: 'long',
                    timeZone: 'Asia/Ho_Chi_Minh',
                  }).format(new Date(summary.currentPeriodEnd))}
                  . Người dùng thanh toán mỗi kỳ qua trang thanh toán.
                </p>
              )}
              {summary.pendingPlan && (
                <p className="mt-3 text-[13px] text-muted-foreground">
                  Gói {summary.pendingPlan.toUpperCase()}{' '}
                  {summary.pendingInterval === 'yearly' ? 'năm' : 'tháng'}
                  {summary.pendingSeatQuantity
                    ? ` · ${summary.pendingSeatQuantity} suất`
                    : ''}{' '}
                  sẽ bắt đầu sau chu kỳ hiện tại.
                </p>
              )}
              {summary.workspace.status === 'pending_subscription' && (
                <p className="mt-4 rounded-lg bg-warm p-3 text-[13px] text-foreground">
                  Không gian làm việc sẽ được kích hoạt sau khi SePay xác nhận
                  thanh toán.
                </p>
              )}
            </section>

            {requestedPlanLabel === 'pro' &&
            summary.workspace.kind === 'company' ? (
              <section className="mt-6 rounded-lg border border-border bg-background p-6">
                <h2 className="text-[23px] font-normal">
                  Pro được quản lý trong tài khoản cá nhân
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Gói Pro chỉ áp dụng cho tài khoản cá nhân, tách biệt với gói
                  Business của công ty.
                </p>
                <Button
                  className="mt-4 h-12 max-w-full whitespace-normal px-5 text-sm font-normal"
                  disabled={busy || !summary.personalWorkspaceId}
                  onClick={() => void switchToPersonalWorkspace()}
                >
                  Chuyển sang tài khoản cá nhân
                </Button>
              </section>
            ) : requestedPlanLabel === 'business' &&
              summary.workspace.kind === 'personal' ? (
              <section className="mt-6 rounded-lg border border-border bg-background p-6">
                <h2 className="text-[23px] font-normal">
                  {summary.ownedCompanyWorkspaces.length > 0
                    ? 'Mua gói Business'
                    : 'Tạo không gian làm việc Business'}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Business được quản lý trong không gian làm việc công ty riêng.
                  {summary.ownedCompanyWorkspaces.length > 0
                    ? ' Chọn không gian làm việc bạn đang sở hữu để thanh toán, hoặc tạo không gian làm việc mới.'
                    : ' Tạo không gian làm việc trước, sau đó mua tối thiểu hai suất trả phí.'}
                </p>
                {summary.ownedCompanyWorkspaces.length > 0 && (
                  <ul className="mt-4 space-y-3">
                    {summary.ownedCompanyWorkspaces.map((workspace) => (
                      <li
                        key={workspace.id}
                        className="flex flex-col gap-3 rounded-lg bg-secondary p-4 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-normal">
                            {workspace.name}
                          </p>
                          <p className="mt-0.5 text-[13px] text-muted-foreground">
                            {workspace.status === 'ready'
                              ? 'Đã kích hoạt'
                              : 'Chưa kích hoạt · chờ thanh toán gói Business'}
                          </p>
                        </div>
                        <Button
                          className="h-11 shrink-0 whitespace-normal px-5 text-sm font-normal"
                          disabled={busy}
                          onClick={() =>
                            void switchToCompanyWorkspace(workspace.id)
                          }
                        >
                          Chuyển sang không gian này
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {summary.ownedCompanyWorkspaces.length > 0 && (
                  <h3 className="mt-6 text-[15px] font-normal">
                    Hoặc tạo không gian làm việc mới
                  </h3>
                )}
                <form
                  onSubmit={createBusinessWorkspace}
                  className="mt-4 flex flex-col gap-3 sm:flex-row"
                >
                  <Input
                    className="h-12 text-sm font-normal"
                    value={workspaceName}
                    onChange={(event) => setWorkspaceName(event.target.value)}
                    placeholder="Tên không gian làm việc công ty"
                    aria-label="Tên không gian làm việc công ty"
                    minLength={2}
                    maxLength={100}
                    required
                    disabled={busy}
                  />
                  <Button
                    className="h-12 px-5 text-sm font-normal"
                    type="submit"
                    disabled={busy || workspaceName.trim().length < 2}
                  >
                    Tạo không gian làm việc
                  </Button>
                </form>
                <Link
                  to="/billing"
                  search={{}}
                  className="mt-4 inline-flex text-[13px] font-normal text-brand hover:underline"
                >
                  Xem gói cho tài khoản cá nhân
                </Link>
              </section>
            ) : summary.workspace.role === 'owner' ? (
              <>
                <CouponField
                  workspaceId={summary.workspaceId}
                  coupon={coupon}
                  onChange={setCoupon}
                  disabled={busy}
                />
                <section className="mt-6 grid gap-6 lg:grid-cols-2">
                  {managesActiveBusiness && summary.interval ? (
                    <article className="min-w-0 rounded-lg border border-border bg-background p-6">
                      <h2 className="text-[23px] font-normal">
                        Quản lý gói Business
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {summary.seatQuantity} suất · thanh toán{' '}
                        {summary.interval === 'monthly'
                          ? 'hàng tháng'
                          : 'hàng năm'}
                        . Thanh toán trước từng kỳ; hạn mức luyện tập được cấp
                        lại mỗi tháng.
                      </p>
                      {changeBlockedReason && (
                        <p
                          role="status"
                          className="mt-4 rounded-lg bg-warm p-3 text-[13px] text-foreground"
                        >
                          {changeBlockedReason}
                        </p>
                      )}
                      <div className="mt-5 grid gap-4">
                        <Button
                          className="min-h-[56px] w-full whitespace-normal rounded-lg px-3 py-3 text-[15px] font-normal"
                          disabled={busy || Boolean(changeBlockedReason)}
                          onClick={() => setSeatsOpen(true)}
                        >
                          Quản lý suất
                        </Button>
                        <Button
                          className="min-h-[56px] w-full whitespace-normal rounded-lg px-3 py-3 text-[15px] font-normal shadow-none"
                          variant="outline"
                          disabled={busy || Boolean(changeBlockedReason)}
                          onClick={() => setIntervalOpen(true)}
                        >
                          Đổi chu kỳ thanh toán
                        </Button>
                        <Button
                          className="min-h-[56px] w-full flex-wrap gap-x-1 whitespace-normal rounded-lg px-3 py-3 text-[15px] font-normal shadow-none"
                          variant="outline"
                          disabled={busy || Boolean(changeBlockedReason)}
                          onClick={() =>
                            void startCheckout(
                              `business_${summary.interval}`,
                              summary.seatQuantity,
                              undefined,
                              true,
                            )
                          }
                        >
                          <span>Gia hạn thêm một kỳ ·</span>
                          <span>
                            <Price
                              priceVnd={
                                subscriptions.business[summary.interval]
                                  .priceVnd * summary.seatQuantity
                              }
                              coupon={coupon}
                              orderType="subscription"
                            />
                          </span>
                        </Button>
                      </div>
                    </article>
                  ) : (
                    <article className="min-w-0 rounded-lg border border-border bg-background p-6">
                      <h2 className="text-[23px] font-normal">
                        {summary.workspace.kind === 'personal'
                          ? 'Nâng cấp tài khoản cá nhân'
                          : summary.workspace.status === 'pending_subscription'
                            ? 'Kích hoạt gói Business'
                            : 'Gia hạn gói Business'}
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Thanh toán trước một kỳ. Hạn mức luyện tập được cấp lại
                        mỗi tháng.
                      </p>
                      {summary.workspace.kind === 'company' ? (
                        <div className="mt-5">
                          <label className="block text-[13px] text-brand">
                            Số suất trả phí
                            <input
                              className="mt-2 block h-11 w-[120px] rounded-lg border border-border bg-background px-3 text-sm font-normal text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                              type="number"
                              min={2}
                              max={500}
                              value={seatQuantity}
                              onChange={(event) =>
                                setSeatQuantity(
                                  Math.max(2, Number(event.target.value) || 2),
                                )
                              }
                            />
                          </label>
                          <p className="mt-2 text-[13px] text-muted-foreground">
                            Tối thiểu 2 suất, tối đa 500 suất.
                          </p>
                        </div>
                      ) : null}
                      <div
                        className={`grid gap-5 ${summary.workspace.kind === 'personal' ? 'mt-12' : 'mt-5'}`}
                      >
                        {summary.workspace.kind === 'personal' ? (
                          <>
                            <Button
                              className="min-h-[74px] min-w-0 w-full flex-wrap gap-x-1 gap-y-0 whitespace-normal rounded-lg px-3 py-3 text-center text-[17px] font-normal"
                              disabled={busy}
                              onClick={() =>
                                void startCheckout(
                                  'pro_monthly',
                                  1,
                                  undefined,
                                  true,
                                )
                              }
                            >
                              <span>Pro tháng ·</span>
                              <span className="max-w-full break-words">
                                <Price
                                  priceVnd={subscriptions.pro.monthly.priceVnd}
                                  coupon={coupon}
                                  orderType="subscription"
                                />
                              </span>
                            </Button>
                            <Button
                              className="min-h-[74px] min-w-0 w-full flex-wrap gap-x-1 gap-y-0 whitespace-normal rounded-lg px-3 py-3 text-center text-[17px] font-normal shadow-none"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void startCheckout(
                                  'pro_yearly',
                                  1,
                                  undefined,
                                  true,
                                )
                              }
                            >
                              <span>Pro năm ·</span>
                              <span className="max-w-full break-words">
                                <Price
                                  priceVnd={subscriptions.pro.yearly.priceVnd}
                                  coupon={coupon}
                                  orderType="subscription"
                                />
                              </span>
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              className="min-h-[74px] min-w-0 w-full flex-wrap gap-x-1 gap-y-0 whitespace-normal rounded-lg px-3 py-3 text-center text-[17px] font-normal"
                              disabled={busy}
                              onClick={() =>
                                void startCheckout(
                                  'business_monthly',
                                  seatQuantity,
                                  undefined,
                                  true,
                                )
                              }
                            >
                              <span>Business tháng ·</span>
                              <span className="max-w-full break-words">
                                <Price
                                  priceVnd={
                                    subscriptions.business.monthly.priceVnd *
                                    seatQuantity
                                  }
                                  coupon={coupon}
                                  orderType="subscription"
                                />
                              </span>
                            </Button>
                            <Button
                              className="min-h-[74px] min-w-0 w-full flex-wrap gap-x-1 gap-y-0 whitespace-normal rounded-lg px-3 py-3 text-center text-[17px] font-normal shadow-none"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void startCheckout(
                                  'business_yearly',
                                  seatQuantity,
                                  undefined,
                                  true,
                                )
                              }
                            >
                              <span>Business năm ·</span>
                              <span className="max-w-full break-words">
                                <Price
                                  priceVnd={
                                    subscriptions.business.yearly.priceVnd *
                                    seatQuantity
                                  }
                                  coupon={coupon}
                                  orderType="subscription"
                                />
                              </span>
                            </Button>
                          </>
                        )}
                      </div>
                    </article>
                  )}
                  <article className="min-w-0 rounded-lg border border-border bg-background p-6">
                    <h2 className="text-[23px] font-normal">
                      Mua thêm phút luyện tập
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      3.000 ₫/phút. Phút mua thêm không hết hạn.
                    </p>
                    {summary.workspace.kind === 'company' && (
                      <label className="mt-5 block text-[13px] text-brand">
                        Thành viên nhận phút mua thêm
                        <NativeSelect
                          wrapperClassName="mt-2 w-full"
                          className="h-11 rounded-lg border-border bg-background px-3 text-sm font-normal text-foreground shadow-none"
                          value={topupRecipientId}
                          onChange={(event) =>
                            setTopupRecipientId(event.target.value)
                          }
                        >
                          <option value="">
                            Chọn thành viên có suất trả phí
                          </option>
                          {summary.members
                            .filter((member) => member.paidSeat)
                            .map((member) => (
                              <option key={member.userId} value={member.userId}>
                                {member.name} · {member.email}
                              </option>
                            ))}
                        </NativeSelect>
                      </label>
                    )}
                    <div className="mt-6 grid grid-cols-2 gap-3">
                      {topupPacks.map((pack) => (
                        <button
                          key={pack.code}
                          type="button"
                          onClick={() => setTopupCode(pack.code)}
                          aria-pressed={topupCode === pack.code}
                          className={`min-h-[66px] min-w-0 rounded-[8px] border border-border px-3 py-3 text-left text-[13px] font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${topupCode === pack.code ? 'bg-secondary' : 'bg-background hover:bg-muted'}`}
                        >
                          <span>{pack.minutes} phút · </span>
                          <span className="inline-block">
                            {money.format(pack.priceVnd)} ₫
                          </span>
                        </button>
                      ))}
                    </div>
                    <Button
                      className="mt-7 h-[50px] w-full whitespace-normal rounded-lg px-3 text-sm font-normal"
                      disabled={
                        busy ||
                        (summary.workspace.kind === 'company' &&
                          (summary.subscriptionStatus !== 'active' ||
                            !topupRecipientId))
                      }
                      onClick={() =>
                        void startCheckout(
                          selectedTopup.code,
                          1,
                          topupRecipientId || undefined,
                          true,
                        )
                      }
                    >
                      <Plus className="mr-2 size-4" />
                      Thanh toán gói {packLabels[selectedTopup.code]}
                      {coupon?.appliesTo.includes('topup') && (
                        <>
                          {' · '}
                          <Price
                            priceVnd={selectedTopup.priceVnd}
                            coupon={coupon}
                            orderType="topup"
                          />
                        </>
                      )}
                    </Button>
                  </article>
                </section>
                {summary.workspace.kind === 'personal' && (
                  <section className="mt-6 flex flex-col gap-4 rounded-lg border border-border bg-background p-6 lg:flex-row lg:items-center lg:gap-6">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[19px] font-normal">
                        Mua cho cả đội? Chọn gói Business
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Từ{' '}
                        {money.format(subscriptions.business.monthly.priceVnd)}{' '}
                        ₫/suất/tháng, tối thiểu {BUSINESS_MIN_SEATS} suất. Gói
                        Business dùng một không gian làm việc công ty riêng,
                        tách biệt với tài khoản cá nhân này.
                      </p>
                    </div>
                    <ButtonLink
                      to="/billing"
                      search={{ plan: 'business' }}
                      variant="outline"
                      className="h-12 shrink-0 whitespace-normal rounded-lg px-5 text-sm font-normal shadow-none"
                    >
                      Mua gói Business
                    </ButtonLink>
                  </section>
                )}
              </>
            ) : (
              <section className="mt-6 rounded-lg border border-border bg-background p-6 text-sm text-muted-foreground">
                Chỉ chủ sở hữu có thể mua gói và phút bổ sung. Hãy liên hệ chủ
                sở hữu để được hỗ trợ.
              </section>
            )}

            {summary.currentPeriodEnd &&
              summary.subscriptionStatus === 'active' &&
              !summary.cancelAtPeriodEnd &&
              !summary.pendingPlan &&
              summary.workspace.role === 'owner' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void cancelRenewal()}
                  className="mt-6 text-[13px] font-normal text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                >
                  Dừng gói khi hết hạn
                </button>
              )}

            {summary.recentOrders.length > 0 && (
              <section
                aria-label="Lịch sử đơn hàng"
                className="mt-6 rounded-lg border border-border bg-background p-6"
              >
                <h2 className="text-[23px] font-normal">Lịch sử đơn hàng</h2>
                {hasPendingPayment && (
                  <div className="mt-3">
                    <p className="text-[13px] text-muted-foreground">
                      Các đơn đang chờ xác nhận được kiểm tra mỗi 15 giây khi
                      trang đang mở. Trạng thái được hiển thị riêng cho từng
                      đơn; hết hạn phiên không có nghĩa là thanh toán bị hủy.
                    </p>
                    <Button
                      className="mt-4 h-auto justify-start px-0 py-0 text-left text-sm font-normal"
                      variant="link"
                      disabled={checkingPayment || busy}
                      onClick={() => void checkPayment()}
                    >
                      {checkingPayment && (
                        <LoaderCircle className="mr-2 size-4 animate-spin" />
                      )}
                      Kiểm tra các đơn đang chờ
                    </Button>
                  </div>
                )}
                {refreshError && (
                  <p
                    role="status"
                    className="mt-3 rounded-lg bg-warm p-3 text-[13px] text-foreground"
                  >
                    {refreshError}
                  </p>
                )}
                <ul className="mt-6 space-y-6">
                  {summary.recentOrders.map((item) => (
                    <li
                      key={item.invoice}
                      className={`min-w-0 rounded-[10px] border-0 p-5 text-[13px] font-normal ${['pending', 'expired', 'review'].includes(item.status) ? 'bg-warm' : 'bg-background'} ${item.invoice === orderInvoice ? 'ring-1 ring-brand' : ''}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-[17px] font-normal">
                            {productLabels[item.productCode] ??
                              item.productCode}
                          </h3>
                          <p className="mt-1 break-all text-xs text-muted-foreground">
                            Mã đơn: {item.invoice}
                          </p>
                          {item.invoice === orderInvoice && (
                            <p className="mt-1 text-xs font-normal text-brand">
                              {checkoutOutcome
                                ? checkoutReturnMessages[checkoutOutcome]
                                : 'Đơn vừa quay về từ trang thanh toán'}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1 sm:text-right">
                          <p className="text-[13px] font-normal">
                            {item.amountVnd === 0
                              ? 'Miễn phí'
                              : `${money.format(item.amountVnd)} ₫`}
                          </p>
                          {item.couponCode && item.discountVnd > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Mã {item.couponCode} · giảm{' '}
                              {money.format(item.discountVnd)} ₫
                            </p>
                          )}
                          <p
                            className={`text-[13px] font-normal ${item.status === 'paid' ? 'text-brand' : ['pending', 'expired', 'review'].includes(item.status) ? 'text-foreground' : 'text-muted-foreground'}`}
                          >
                            {orderStatusLabels[item.status] ?? 'Cần kiểm tra'}
                          </p>
                        </div>
                      </div>
                      {['pending', 'expired'].includes(item.status) && (
                        <p className="mt-3 text-[13px] leading-5 text-foreground">
                          Chưa xác nhận thanh toán cho đơn này. Nếu đã trả tiền,
                          vui lòng không thanh toán lại.
                        </p>
                      )}
                      {['pending', 'expired'].includes(item.status) &&
                        summary.workspace.role === 'owner' && (
                          <Button
                            className="mt-3 h-auto justify-start whitespace-normal px-0 py-0 text-left text-[13px] font-normal"
                            variant="link"
                            disabled={busy || checkingPayment}
                            onClick={() => void cancelOrder(item.invoice)}
                          >
                            {cancellingInvoice === item.invoice && (
                              <LoaderCircle className="mr-2 size-4 animate-spin" />
                            )}
                            Hủy đơn nếu chưa thanh toán
                          </Button>
                        )}
                      {orderNotice?.invoice === item.invoice && (
                        <p
                          role="status"
                          className="mt-3 text-[13px] leading-5 text-muted-foreground"
                        >
                          {orderNotice.message}
                        </p>
                      )}
                      {item.status === 'review' && (
                        <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
                          SePay đã xác nhận tiền cho đơn này; đang kiểm tra
                          trước khi cấp quyền lợi.
                        </p>
                      )}
                      {item.verificationWarning && item.status !== 'paid' && (
                        <p
                          role="status"
                          className="mt-3 rounded-lg bg-warm p-3 text-[13px] leading-5 text-foreground"
                        >
                          Kiểm tra đơn này: {item.verificationWarning}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : null}
        {summary && seatsOpen && (
          <ManageSeatsModal
            open={seatsOpen}
            onOpenChange={setSeatsOpen}
            summary={summary}
            busy={busy}
            error={error}
            onPay={(productCode, seats) =>
              void startCheckout(productCode, seats)
            }
          />
        )}
        {summary && intervalOpen && (
          <SwitchIntervalModal
            open={intervalOpen}
            onOpenChange={setIntervalOpen}
            summary={summary}
            busy={busy}
            error={error}
            onPay={(productCode, seats) =>
              void startCheckout(productCode, seats)
            }
          />
        )}
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-destructive-subtle p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </div>
    </main>
  )
}
