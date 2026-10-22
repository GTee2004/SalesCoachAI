import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type {
  AssessmentCoverage,
  AssessmentStatus,
} from '#/lib/practice/assessment'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  username: varchar('username', { length: 255 }).unique(),
  roles: varchar('roles', { length: 255 }).array().notNull(),
})

// Structural parent only in phase 1. Membership and billing belong to workspaces.
export const company = pgTable('company', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})

export const organization = pgTable(
  'organization',
  {
    id: text('id').primaryKey(),
    // Every new workspace gets a company, including Personal. This is deliberately
    // not unique: several workspaces can share a company in a future phase.
    companyId: uuid('company_id')
      .notNull()
      .references(() => company.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    metadata: text('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('organization_company_id_idx').on(table.companyId)],
)

export const companyRelations = relations(company, ({ many }) => ({
  workspaces: many(organization),
}))

export const organizationRelations = relations(organization, ({ one }) => ({
  company: one(company, {
    fields: [organization.companyId],
    references: [company.id],
  }),
}))

export const workspaceKindEnum = pgEnum('workspace_kind', [
  'personal',
  'company',
])

export const workspaceStatusEnum = pgEnum('workspace_status', [
  'ready',
  'pending_subscription',
])

export const subscriptionPlanEnum = pgEnum('subscription_plan', [
  'free',
  'pro',
  'business',
])

export const billingIntervalEnum = pgEnum('billing_interval', [
  'monthly',
  'yearly',
])

export const billingOrderTypeEnum = pgEnum('billing_order_type', [
  'subscription',
  'topup',
  'seat_addition',
])

export const billingOrderStatusEnum = pgEnum('billing_order_status', [
  'pending',
  'paid',
  'cancelled',
  'void',
  'failed',
  'review',
])

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'cancelled',
  'expired',
])

export const couponDiscountTypeEnum = pgEnum('coupon_discount_type', [
  'percent',
  'fixed',
])

export const creditGrantTypeEnum = pgEnum('credit_grant_type', [
  'included',
  'topup',
  'adjustment',
])

export const workspaceProfiles = pgTable(
  'workspace_profiles',
  {
    workspaceId: text('workspace_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),

    kind: workspaceKindEnum('kind').notNull(),

    personalOwnerUserId: text('personal_owner_user_id').references(
      () => user.id,
      { onDelete: 'cascade' },
    ),

    status: workspaceStatusEnum('status').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('workspace_profiles_personal_owner_unique').on(
      table.personalOwnerUserId,
    ),

    check(
      'workspace_profiles_owner_matches_kind',
      sql`
        (
          ${table.kind} = 'personal'
          AND ${table.personalOwnerUserId} IS NOT NULL
        )
        OR
        (
          ${table.kind} = 'company'
          AND ${table.personalOwnerUserId} IS NULL
        )
      `,
    ),
  ],
)

// Financial history belongs to a workspace and must survive workspace/member
// cleanup. db:push is intentionally left to the operator.
export const workspaceSubscriptions = pgTable(
  'workspace_subscriptions',
  {
    workspaceId: text('workspace_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'restrict' }),
    plan: subscriptionPlanEnum('plan').notNull(),
    interval: billingIntervalEnum('interval').notNull(),
    status: subscriptionStatusEnum('status').default('active').notNull(),
    seatQuantity: integer('seat_quantity').default(1).notNull(),
    pendingPlan: subscriptionPlanEnum('pending_plan'),
    pendingInterval: billingIntervalEnum('pending_interval'),
    pendingSeatQuantity: integer('pending_seat_quantity'),
    currentPeriodStart: timestamp('current_period_start', {
      withTimezone: true,
    }).notNull(),
    currentPeriodEnd: timestamp('current_period_end', {
      withTimezone: true,
    }).notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      'workspace_subscriptions_seats_positive',
      sql`${table.seatQuantity} > 0`,
    ),
    check(
      'workspace_subscriptions_period_order',
      sql`${table.currentPeriodEnd} > ${table.currentPeriodStart}`,
    ),
  ],
)

export const billingOrders = pgTable(
  'billing_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    purchasedByUserId: text('purchased_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    creditRecipientUserId: text('credit_recipient_user_id').references(
      () => user.id,
      { onDelete: 'restrict' },
    ),
    orderInvoiceNumber: varchar('order_invoice_number', { length: 64 })
      .notNull()
      .unique(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    type: billingOrderTypeEnum('type').notNull(),
    productCode: varchar('product_code', { length: 64 }).notNull(),
    plan: subscriptionPlanEnum('plan'),
    interval: billingIntervalEnum('interval'),
    seatQuantity: integer('seat_quantity').default(1).notNull(),
    creditMinutes: integer('credit_minutes').default(0).notNull(),
    // What the customer pays. List price is amountVnd + discountVnd. A fully
    // discounted order is 0, is created already paid and never reaches SePay.
    amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
    discountVnd: bigint('discount_vnd', { mode: 'number' })
      .default(0)
      .notNull(),
    couponCode: varchar('coupon_code', { length: 40 }),
    currency: varchar('currency', { length: 3 }).default('VND').notNull(),
    status: billingOrderStatusEnum('status').default('pending').notNull(),
    sepayOrderId: varchar('sepay_order_id', { length: 128 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    maintenanceAttempts: integer('maintenance_attempts').default(0).notNull(),
    maintenanceNextAt: timestamp('maintenance_next_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    maintenanceLeaseUntil: timestamp('maintenance_lease_until', {
      withTimezone: true,
    }),
    maintenanceLeaseToken: uuid('maintenance_lease_token'),
    providerPayload: jsonb('provider_payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('billing_orders_workspace_idempotency_unique').on(
      table.workspaceId,
      table.purchasedByUserId,
      table.idempotencyKey,
    ),
    index('billing_orders_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
    index('billing_orders_status_expiry_idx').on(table.status, table.expiresAt),
    index('billing_orders_maintenance_due_idx').on(
      table.status,
      table.maintenanceNextAt,
    ),
    // Only a coupon may take an order to zero; a 0 VND order without a
    // discount is always a bug.
    check(
      'billing_orders_amount_valid',
      sql`${table.amountVnd} >= 0 AND ${table.discountVnd} >= 0 AND (${table.amountVnd} > 0 OR ${table.discountVnd} > 0)`,
    ),
    check('billing_orders_seats_positive', sql`${table.seatQuantity} > 0`),
    check(
      'billing_orders_credits_nonnegative',
      sql`${table.creditMinutes} >= 0`,
    ),
  ],
)

// Created by platform admins. A coupon's code, type and value are immutable once
// created so past orders stay explainable; retire it with `active` instead.
export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Stored upper-case; see normalizeCouponCode.
    code: varchar('code', { length: 40 }).notNull().unique(),
    name: text('name').notNull(),
    discountType: couponDiscountTypeEnum('discount_type').notNull(),
    // 1-100 for percent, a positive VND amount for fixed.
    value: integer('value').notNull(),
    // Ceiling on a percent coupon's discount, in VND; null means no ceiling.
    maxDiscountVnd: integer('max_discount_vnd'),
    appliesTo: varchar('applies_to', { length: 32 })
      .array()
      .$type<Array<'subscription' | 'topup'>>()
      .notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // null means unlimited.
    maxRedemptions: integer('max_redemptions'),
    maxRedemptionsPerWorkspace: integer('max_redemptions_per_workspace')
      .default(1)
      .notNull(),
    active: boolean('active').default(true).notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      'coupons_value_valid',
      sql`(${table.discountType} = 'percent' AND ${table.value} BETWEEN 1 AND 100) OR (${table.discountType} = 'fixed' AND ${table.value} > 0)`,
    ),
    check(
      'coupons_max_discount_valid',
      sql`${table.maxDiscountVnd} IS NULL OR (${table.discountType} = 'percent' AND ${table.maxDiscountVnd} > 0)`,
    ),
    check(
      'coupons_limits_valid',
      sql`${table.maxRedemptionsPerWorkspace} > 0 AND (${table.maxRedemptions} IS NULL OR ${table.maxRedemptions} > 0)`,
    ),
    check(
      'coupons_window_valid',
      sql`${table.startsAt} IS NULL OR ${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.startsAt}`,
    ),
  ],
)

// One row per order that used a coupon. Whether it still counts toward a limit
// is derived from the order's status (pending, paid and review hold it;
// cancelled, void and failed release it), so no release hook is needed.
export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => billingOrders.id, { onDelete: 'restrict' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    discountVnd: bigint('discount_vnd', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('coupon_redemptions_coupon_workspace_idx').on(
      table.couponId,
      table.workspaceId,
    ),
    check(
      'coupon_redemptions_discount_positive',
      sql`${table.discountVnd} > 0`,
    ),
  ],
)

export const billingPayments = pgTable(
  'billing_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => billingOrders.id, { onDelete: 'restrict' }),
    provider: varchar('provider', { length: 32 }).default('sepay').notNull(),
    providerTransactionId: varchar('provider_transaction_id', {
      length: 128,
    }).notNull(),
    providerOrderId: varchar('provider_order_id', { length: 128 }),
    environment: varchar('environment', { length: 16 }).notNull(),
    amountVnd: bigint('amount_vnd', { mode: 'number' }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    providerPayload: jsonb('provider_payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('billing_payments_order_idx').on(table.orderId),
    uniqueIndex('billing_payments_transaction_unique').on(
      table.environment,
      table.provider,
      table.providerTransactionId,
    ),
  ],
)

export const subscriptionPeriods = pgTable(
  'subscription_periods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => billingOrders.id, { onDelete: 'restrict' }),
    plan: subscriptionPlanEnum('plan').notNull(),
    interval: billingIntervalEnum('interval').notNull(),
    seatQuantity: integer('seat_quantity').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('subscription_periods_workspace_start_idx').on(
      table.workspaceId,
      table.startsAt,
    ),
    check(
      'subscription_periods_seats_positive',
      sql`${table.seatQuantity} > 0`,
    ),
    check(
      'subscription_periods_end_after_start',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
  ],
)

export const billingWebhookEvents = pgTable(
  'billing_webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventKey: varchar('event_key', { length: 200 }).notNull().unique(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('billing_webhook_events_unprocessed_idx').on(table.processedAt),
  ],
)

export type SeatAssignReason =
  'invitation_accepted' | 'owner_assigned' | 'subscription_activated'
export type SeatRevokeReason = 'member_removed' | 'member_left'

// Each row is one stint of a member holding a seat. Rows are never reopened:
// giving a seat back inserts a new row, so the table is the seat history.
export const workspaceSeatAssignments = pgTable(
  'workspace_seat_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    seatNumber: integer('seat_number').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    // The actor is null when the system acted (invitation, first payment).
    // Reasons are null on rows written before seat history was recorded.
    assignedByUserId: text('assigned_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    assignReason: varchar('assign_reason', {
      length: 32,
    }).$type<SeatAssignReason>(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: text('revoked_by_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    revokeReason: varchar('revoke_reason', {
      length: 32,
    }).$type<SeatRevokeReason>(),
  },
  (table) => [
    uniqueIndex('workspace_seat_assignments_active_user_unique')
      .on(table.workspaceId, table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
    index('workspace_seat_assignments_user_idx').on(
      table.workspaceId,
      table.userId,
      table.assignedAt,
    ),
    index('workspace_seat_assignments_seat_idx').on(
      table.workspaceId,
      table.seatNumber,
      table.assignedAt,
    ),
    index('workspace_seat_assignments_active_idx').on(
      table.workspaceId,
      table.revokedAt,
    ),
    uniqueIndex('workspace_seat_assignments_active_slot_unique')
      .on(table.workspaceId, table.seatNumber)
      .where(sql`${table.revokedAt} IS NULL`),
    check(
      'workspace_seat_assignments_slot_positive',
      sql`${table.seatNumber} > 0`,
    ),
  ],
)

export const creditGrants = pgTable(
  'credit_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'restrict' }),
    seatNumber: integer('seat_number'),
    type: creditGrantTypeEnum('type').notNull(),
    grantKey: varchar('grant_key', { length: 200 }).notNull().unique(),
    orderId: uuid('order_id').references(() => billingOrders.id, {
      onDelete: 'restrict',
    }),
    totalSeconds: integer('total_seconds').notNull(),
    remainingSeconds: integer('remaining_seconds').notNull(),
    reservedSeconds: integer('reserved_seconds').default(0).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('credit_grants_order_unique').on(table.orderId),
    index('credit_grants_spendable_idx').on(
      table.workspaceId,
      table.userId,
      table.expiresAt,
    ),
    check('credit_grants_total_positive', sql`${table.totalSeconds} > 0`),
    check(
      'credit_grants_balance_valid',
      sql`${table.reservedSeconds} >= 0 AND ${table.reservedSeconds} <= ${table.remainingSeconds} AND ${table.remainingSeconds} <= ${table.totalSeconds}`,
    ),
  ],
)

export const creditReservations = pgTable(
  'credit_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => creditGrants.id, { onDelete: 'restrict' }),
    reservedSeconds: integer('reserved_seconds').notNull(),
    settledSeconds: integer('settled_seconds'),
    // Time the learner used but was not charged for, because the voice service
    // failed: dead time after a failed reply, or a whole attempt that ended
    // before the opening line finished. The call may run past its reservation
    // by this much, so it is not bounded by reservedSeconds.
    waivedSeconds: integer('waived_seconds').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('credit_reservations_attempt_grant_unique').on(
      table.sessionId,
      table.attemptId,
      table.grantId,
    ),
    index('credit_reservations_unsettled_idx').on(table.settledAt),
    check(
      'credit_reservations_amount_positive',
      sql`${table.reservedSeconds} > 0`,
    ),
    check(
      'credit_reservations_settlement_valid',
      sql`${table.settledSeconds} IS NULL OR (${table.settledSeconds} >= 0 AND ${table.settledSeconds} <= ${table.reservedSeconds})`,
    ),
    check('credit_reservations_waiver_valid', sql`${table.waivedSeconds} >= 0`),
  ],
)

export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    grantId: uuid('grant_id')
      .notNull()
      .references(() => creditGrants.id, { onDelete: 'restrict' }),
    idempotencyKey: varchar('idempotency_key', { length: 220 })
      .notNull()
      .unique(),
    deltaSeconds: integer('delta_seconds').notNull(),
    reason: varchar('reason', { length: 48 }).notNull(),
    fromUserId: text('from_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    toUserId: text('to_user_id').references(() => user.id, {
      onDelete: 'restrict',
    }),
    sessionId: uuid('session_id'),
    attemptId: uuid('attempt_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('credit_ledger_grant_created_idx').on(table.grantId, table.createdAt),
  ],
)

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').default('member').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('member_organization_id_idx').on(table.organizationId),
    index('member_user_id_idx').on(table.userId),
    uniqueIndex('member_organization_user_unique').on(
      table.organizationId,
      table.userId,
    ),
  ],
)

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').default('pending').notNull(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('invitation_organization_id_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
  ],
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    activeOrganizationId: text('active_organization_id'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

/* =========================================================
 * ENUMS
 * ======================================================= */

/**
 * Every Practice is a phone call placed by the salesperson.
 * `quick_drill` (one skill / one objection) is planned for Phase 2.
 */
export const practiceTypeEnum = pgEnum('practice_type', [
  'cold_call',
  'warm_call',
])

export const practiceStatusEnum = pgEnum('practice_status', [
  'draft',
  'published',
  'archived',
])

export const difficultyEnum = pgEnum('practice_difficulty', [
  'beginner',
  'intermediate',
  'advanced',
])

export const sessionStatusEnum = pgEnum('practice_session_status', [
  'created',
  'in_progress',
  'completed',
  'abandoned',
])

export const sessionEndReasonEnum = pgEnum('practice_session_end_reason', [
  'learner_ended',
  'buyer_hung_up',
  'time_limit',
  'technical_error',
  'learner_idle',
  'connection_lost',
])

export const objectiveOutcomeEnum = pgEnum('practice_objective_outcome', [
  'achieved',
  'partially_achieved',
  'not_achieved',
])

export const speakerEnum = pgEnum('practice_speaker', ['salesperson', 'buyer'])

export type PracticeType = (typeof practiceTypeEnum.enumValues)[number]
export type SessionEndReason = (typeof sessionEndReasonEnum.enumValues)[number]
export type Difficulty = (typeof difficultyEnum.enumValues)[number]

/* =========================================================
 * BUYER PERSONA
 *
 * The buyer is authored once, in Layer B. The learner-visible
 * buyer card is derived from it via `learnerKnows`.
 * ======================================================= */

export type AddressTerm = 'anh' | 'chị' | 'cô' | 'chú' | 'bác' | 'em'

/** Mua để ở / Đầu tư / Ở trước, cho thuê sau hoặc mua cho con. */
export type BuyerMotivation = 'own_use' | 'investment' | 'mixed'

export type DecisionRole =
  'sole_decision_maker' | 'joint_with_spouse' | 'family_decision' | 'influencer'

/**
 * Starting mood, ordered from easiest to hardest.
 * Thân thiện / Trung lập / Dè dặt / Thiếu kiên nhẫn / Gay gắt.
 */
export type EmotionalState =
  'friendly' | 'neutral' | 'guarded' | 'impatient' | 'hostile'

/**
 * Monetary values in the Vietnamese-market product are VND-only.
 * Keep this named type and the persisted currency field so more currencies can
 * be introduced later without reshaping the JSON contracts.
 */
export type Currency = 'VND'

export type UrgencyLevel = 'low' | 'medium' | 'high'

export type BuyerProfile = {
  name: string
  addressTerm: AddressTerm
  gender: 'male' | 'female'
  age: number
  occupation?: string
  familySituation?: string

  motivation: {
    type: BuyerMotivation
    detail: string
  }

  budget: {
    min?: number
    max: number
    currency: Currency
    /** "Tiết kiệm + vay 50%", "Bán căn hộ cũ" */
    fundingSource?: string
    /** How the buyer feels about the price. */
    detail?: string
  }

  /** Ordered: most important first. */
  priorities: string[]

  decisionMaker: {
    role: DecisionRole
    detail?: string
  }

  urgency: {
    level: UrgencyLevel
    timeline?: string
    driver?: string
  }

  emotionalState: EmotionalState

  communicationStyle?: string[]

  /** TTS voice is selected by `gender`; these refine delivery. */
  voice?: {
    voiceId?: string
    speakingStyle?: string
    pace?: 'slow' | 'normal' | 'fast'
  }
}

/**
 * Buyer attributes the caller can know before dialing.
 * `name` and `addressTerm` are always known. A parent path
 * discloses the whole object; a dotted path discloses one field.
 * `budget.detail` and `urgency.driver` are never disclosable.
 */
export const BUYER_FIELDS = [
  'age',
  'occupation',
  'familySituation',
  'emotionalState',
  'motivation',
  'motivation.type',
  'budget',
  'budget.min',
  'budget.max',
  'budget.fundingSource',
  'priorities',
  'decisionMaker',
  'decisionMaker.role',
  'urgency',
  'urgency.level',
  'urgency.timeline',
] as const

export type BuyerField = (typeof BUYER_FIELDS)[number]

/* =========================================================
 * SALES OFFERING ("What you're selling")
 *
 * Learner-visible, reusable across practices.
 * ======================================================= */

export type SalesOfferingConfig = {
  productType:
    'apartment' | 'townhouse' | 'villa' | 'shophouse' | 'land' | 'other'

  projectName: string
  developer?: string

  location: {
    district: string
    city: string
    address?: string
    highlights?: string[]
  }

  unit: {
    bedrooms?: number
    bathrooms?: number
    areaM2: number
    floor?: string
    view?: string
    furnishing?: string
  }

  price: {
    amount: number
    currency: Currency
    pricePerM2?: number
    note?: string
  }

  paymentPlan: {
    summary: string
    milestones?: Array<{ label: string; percent: number; timing: string }>
    loanSupport?: string
    promotions?: string[]
  }

  handover?: string
  legalStatus?: string

  /**
   * Month the prices, policies and handover status describe, as YYYY-MM.
   * The call is set in this month, so practices stay consistent after the
   * real project moves on.
   */
  asOf?: string

  keyStrengths: string[]
  keyWeaknesses: string[]

  competitors?: Array<{ name: string; comparison: string }>
}

/* =========================================================
 * LAYER A
 *
 * What the salesperson legitimately knows before dialing.
 * Safe to send to the frontend.
 * ======================================================= */

export type PreviousInteraction = {
  /** "Thứ Ba tuần trước" */
  when: string
  channel: 'phone' | 'zalo' | 'showroom' | 'site_visit' | 'event'
  summary: string
  /** "Gọi lại sau khi chị trao đổi với chồng" */
  agreedNextStep?: string
}

/** Stored situation + objective. Buyer data is never stored here. */
export type LearnerBrief = {
  /**
   * "What happened before this call?" — second person.
   *
   * Cold: "Bạn gọi cho anh Hùng lần đầu. Anh để lại số trên landing page 3 ngày trước."
   * Warm: "Bạn đã nói chuyện với chị Lan tuần trước. Chị nói cần bàn với chồng."
   */
  background: string

  /** Cold call: where the lead came from. */
  leadSource?: string

  /** Warm call: required, non-empty. Cold call: must be empty. */
  previousInteractions?: PreviousInteraction[]

  /**
   * One observable outcome achievable in this call.
   * Must not reveal hidden insights or objections.
   */
  objective: string
}

type DeepPartial<T> = { [K in keyof T]?: DeepPartial<T[K]> }

/**
 * Learner-visible buyer card. Derived from Layer B `buyer` +
 * `learnerKnows` at read time; never stored or authored.
 */
export type LearnerBuyerCard = {
  name: string
  addressTerm: AddressTerm
  age?: number
  occupation?: string
  familySituation?: string
  emotionalState?: EmotionalState
  known?: DeepPartial<
    Pick<
      BuyerProfile,
      'motivation' | 'budget' | 'priorities' | 'decisionMaker' | 'urgency'
    >
  >
}

/** Practice Card brief returned to the learner. */
export type LearnerBriefView = LearnerBrief & { buyer: LearnerBuyerCard }

/* =========================================================
 * LAYER B
 *
 * Private buyer reality. SERVER-ONLY.
 * ======================================================= */

/** Information the salesperson should discover. Semantic, not a state machine. */
export type HiddenInsight = {
  key: string
  insight: string
  revealGuidance?: string
  /**
   * Profile field this insight explains or deepens.
   * Must not be disclosed by `learnerKnows`.
   */
  relatesTo?: BuyerField
}

export type ObjectionCategory =
  | 'brush_off'
  | 'not_interested'
  | 'timing'
  | 'price'
  | 'trust'
  | 'product'
  | 'decision_authority'
  | 'competitor'

/** Resistance the buyer actively raises. */
export type ObjectionSpec = {
  key: string
  category: ObjectionCategory
  /** How the buyer might say it; the AI may paraphrase. */
  sampleWording: string
  underlyingReason?: string
  raiseGuidance: string
  resolutionGuidance: string
}

type BuyerAgentConfigBase = {
  buyer: BuyerProfile

  /** Buyer fields shown on the Practice Card. Everything else is to discover. */
  learnerKnows: BuyerField[]

  /** The buyer's private view of the situation, as instructions to the AI buyer. */
  privateBackground: string

  hiddenInsights: HiddenInsight[]

  objections: ObjectionSpec[]

  /**
   * Exact first words when picking up the phone ("Alo, ai đấy ạ?").
   * Defaults are derived from call type + emotional state.
   */
  openingLine?: string

  /** When the buyer should end the call on their own. */
  hangUpGuidance?: string

  behaviorRules: string[]

  /** Observable conditions meaning the call objective was achieved. Evaluator-only. */
  successCriteria: string[]

  /**
   * What the buyer remembers about the caller: how they got the number (cold)
   * or what was said last time (warm).
   */
  recollection: string
}

export type ColdCallAgentConfig = BuyerAgentConfigBase & {
  kind: 'cold_call'
}

export type WarmCallAgentConfig = BuyerAgentConfigBase & {
  kind: 'warm_call'
  /** What changed since the last contact. */
  sinceLastContact: string
}

export type PracticeAgentConfig = ColdCallAgentConfig | WarmCallAgentConfig

/* =========================================================
 * COMPETENCY RUBRIC
 * ======================================================= */

export type CompetencyRubric = {
  description: string
  behaviors: { id: string; description: string }[]
  levels: {
    id: string
    label: string
    score: number
    requiredBehaviorIds: string[]
  }[]
  criticalErrors: { id: string; description: string; scoreCap: number }[]
}

/* =========================================================
 * EVALUATION TYPES
 * ======================================================= */

export type EvaluationEvidence = {
  turnNumber: number

  quote?: string

  observation: string
}

export type BehavioralFinding = {
  id: string
  kind: 'demonstrated' | 'attempted' | 'opportunity_missed' | 'critical_error'
  behaviorId?: string
  criticalErrorId?: string
  rationale: string
  evidence: EvaluationEvidence[]
  opportunityTurnNumbers: number[]
  responseTurnNumbers: number[]
}

export type FeedbackStatement = {
  text: string
  turnNumbers: number[]
  findingIds: string[]
}

export type ScoreExplanation = {
  levelId: string
  levelLabel: string
  baseScore: number
  /** Demonstrated behaviors that reached the level; their count, not order, sets it. */
  requiredBehaviorIds: string[]
  findingIds: string[]
  appliedCaps: {
    criticalErrorId: string
    scoreCap: number
    findingIds: string[]
  }[]
}

export type ObjectionOutcome = {
  key: string
  raised: boolean
  handling?: 'handled' | 'partially_handled' | 'not_handled'
  evidence?: EvaluationEvidence[]
}

export type LearningRecommendation = {
  practiceType?: PracticeType

  competencyCode?: string

  objectionKey?: string

  reason: string

  suggestedPracticeId?: string
}

/* =========================================================
 * COMPETENCIES
 *
 * Stable skills across many different practices.
 *
 * Scorecard criteria are competencies. Examples:
 *
 * opening_hook
 * reconnect_agenda
 * needs_discovery
 * qualification
 * objection_diagnosis
 * objection_handling
 * value_articulation
 * next_step_closing
 * rapport
 * conversation_control
 * ======================================================= */

export const competencies = pgTable(
  'competencies',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    code: text('code').notNull(),

    name: text('name').notNull(),

    description: text('description'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex('competencies_code_uidx').on(table.code)],
)

/* =========================================================
 * SALES OFFERINGS
 *
 * "What you're selling". Learner-visible and reusable
 * across practices.
 *
 * Once referenced by a published practice with sessions,
 * material fields (price, payment plan, unit, strengths /
 * weaknesses) must not change: create a new offering and
 * duplicate the affected practices instead.
 * ======================================================= */

export const salesOfferings = pgTable(
  'sales_offerings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: text('workspace_id').references(() => organization.id, {
      onDelete: 'restrict',
    }),
    isGlobal: boolean('is_global').default(false).notNull(),

    /**
     * Internal name for authors.
     *
     * Example: "The Paris PR5 - 2PN 65m2 - 3,9 tỷ VND"
     */
    name: text('name').notNull(),

    offering: jsonb('offering').$type<SalesOfferingConfig>().notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('sales_offerings_workspace_idx').on(table.workspaceId),
    check(
      'sales_offerings_global_scope_check',
      sql`NOT ${table.isGlobal} OR ${table.workspaceId} IS NULL`,
    ),
  ],
)

/* =========================================================
 * PRACTICES
 *
 * ONE PRACTICE = ONE CONCRETE PHONE CALL
 * (buyer + background + offering + objective + scorecard).
 *
 * There is NO version layer.
 *
 * If you substantially change the buyer situation,
 * create another practice.
 * ======================================================= */

export const practices = pgTable(
  'practices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: text('workspace_id').references(() => organization.id, {
      onDelete: 'restrict',
    }),
    isGlobal: boolean('is_global').default(false).notNull(),

    slug: text('slug').notNull(),

    type: practiceTypeEnum('type').notNull(),

    /**
     * SALESPERSON-FACING TITLE.
     *
     * Do not reveal the hidden issue here.
     *
     * Good:
     * "Gọi lại lần 2 - Chị Lan"
     *
     * Avoid:
     * "Gọi lại lần 2 - Chồng không đồng ý"
     */
    title: text('title').notNull(),

    description: text('description'),

    status: practiceStatusEnum('status').default('draft').notNull(),

    difficulty: difficultyEnum('difficulty').notNull(),

    locale: text('locale').default('vi-VN').notNull(),

    estimatedMinutes: integer('estimated_minutes'),

    /**
     * Optional internal classification.
     *
     * Examples:
     *
     * [
     *   "follow_up",
     *   "family_buyer",
     *   "spouse_decision",
     *   "price_objection"
     * ]
     */
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),

    /* ========================
     * LAYER A
     * ====================== */

    learnerBrief: jsonb('learner_brief').$type<LearnerBrief>().notNull(),

    /**
     * What the salesperson is selling. Learner-visible.
     */
    salesOfferingId: uuid('sales_offering_id')
      .notNull()
      .references(() => salesOfferings.id, {
        onDelete: 'restrict',
      }),

    /**
     * Optional additional instructions visible to learner.
     */
    learnerInstructions: text('learner_instructions'),

    createdByUserId: text('created_by_user_id'),

    publishedAt: timestamp('published_at', {
      withTimezone: true,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('practices_slug_uidx').on(table.slug),

    index('practices_type_status_idx').on(table.type, table.status),

    index('practices_difficulty_idx').on(table.difficulty),

    index('practices_sales_offering_idx').on(table.salesOfferingId),
    index('practices_workspace_owner_status_idx').on(
      table.workspaceId,
      table.createdByUserId,
      table.status,
    ),
    check(
      'practices_global_scope_check',
      sql`NOT ${table.isGlobal} OR (${table.workspaceId} IS NULL AND ${table.createdByUserId} IS NULL)`,
    ),
  ],
)

/* =========================================================
 * PRACTICE AGENT CONFIG
 *
 * ========================
 * LAYER B
 * ========================
 *
 * One-to-one with practices.
 *
 * KEEP SERVER-SIDE.
 *
 * Do not return this row from the learner-facing
 * practice API.
 * ======================================================= */

export const practiceAgentConfigs = pgTable('practice_agent_configs', {
  practiceId: uuid('practice_id')
    .primaryKey()
    .references(() => practices.id, {
      onDelete: 'cascade',
    }),

  /**
   * Private buyer reality and AI behavior.
   * `config.kind` must equal `practices.type`.
   */
  config: jsonb('config').$type<PracticeAgentConfig>().notNull(),

  updatedAt: timestamp('updated_at', {
    withTimezone: true,
  })
    .defaultNow()
    .notNull(),
})

/* =========================================================
 * PRACTICE ↔ COMPETENCIES
 *
 * Many practices can train the same competency.
 *
 * One practice can evaluate several competencies.
 *
 * No PRIMARY / SECONDARY role.
 * Weight already expresses importance.
 * ======================================================= */

export const practiceCompetencies = pgTable(
  'practice_competencies',
  {
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, {
        onDelete: 'cascade',
      }),

    competencyId: uuid('competency_id')
      .notNull()
      .references(() => competencies.id, {
        onDelete: 'restrict',
      }),

    /**
     * Contribution to the practice's overall score.
     *
     * Example:
     *
     * Cold call scorecard:
     *
     * opening_hook = 20
     * needs_discovery = 25
     * value_articulation = 15
     * objection_handling = 20
     * next_step_closing = 20
     *
     * Application logic should verify total = 100.
     */
    weight: integer('weight').notNull(),

    /**
     * Rubric specific to this competency
     * IN THIS particular practice.
     */
    rubric: jsonb('rubric').$type<CompetencyRubric>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.practiceId, table.competencyId],
    }),

    check(
      'practice_competency_weight_check',
      sql`${table.weight} >= 0 AND ${table.weight} <= 100`,
    ),

    index('practice_competencies_competency_idx').on(table.competencyId),
  ],
)

/* =========================================================
 * PRACTICE SESSIONS
 *
 * One salesperson attempt of one concrete practice.
 * ======================================================= */

export const practiceSessions = pgTable(
  'practice_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),

    /**
     * Directly references the concrete practice.
     *
     * No practiceVersionId anymore.
     */
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, {
        onDelete: 'restrict',
      }),

    status: sessionStatusEnum('status').default('created').notNull(),

    /**
     * Set when the session completes.
     */
    endReason: sessionEndReasonEnum('end_reason'),

    /** Operational state: voiceConnection, ttsProvider and evaluationError. */
    runtimeMetadata: jsonb('runtime_metadata').$type<Record<string, unknown>>(),

    startedAt: timestamp('started_at', {
      withTimezone: true,
    }),

    completedAt: timestamp('completed_at', {
      withTimezone: true,
    }),

    /** Hidden from learners; retained to safely discard late voice events. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('practice_sessions_workspace_user_created_idx').on(
      table.workspaceId,
      table.userId,
      table.createdAt,
    ),

    index('practice_sessions_practice_idx').on(table.practiceId),

    index('practice_sessions_status_idx').on(table.status),
  ],
)

/* =========================================================
 * SESSION TURNS
 *
 * Transcript of the live voice conversation.
 * ======================================================= */

export const practiceSessionTurns = pgTable(
  'practice_session_turns',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    sessionId: uuid('session_id')
      .notNull()
      .references(() => practiceSessions.id, {
        onDelete: 'cascade',
      }),

    /**
     * 1, 2, 3...
     *
     * The buyer answers the phone, so turn 1 is
     * normally the buyer ("Alo, ai đấy ạ?").
     */
    sequence: integer('sequence').notNull(),

    speaker: speakerEnum('speaker').notNull(),

    text: text('text').notNull(),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('practice_turn_session_sequence_uidx').on(
      table.sessionId,
      table.sequence,
    ),
  ],
)

/* =========================================================
 * SESSION EVALUATION
 *
 * Overall AI Coach result.
 * ======================================================= */

export const practiceSessionEvaluations = pgTable(
  'practice_session_evaluations',
  {
    sessionId: uuid('session_id')
      .primaryKey()
      .references(() => practiceSessions.id, {
        onDelete: 'cascade',
      }),

    overallScore: integer('overall_score'),

    assessmentCoverage: jsonb('assessment_coverage')
      .$type<AssessmentCoverage>()
      .notNull(),

    summary: text('summary').notNull(),

    summaryFindings: jsonb('summary_findings')
      .$type<FeedbackStatement[]>()
      .notNull(),

    strengths: jsonb('strengths').$type<FeedbackStatement[]>().notNull(),

    improvements: jsonb('improvements').$type<FeedbackStatement[]>().notNull(),

    /**
     * One most important coaching takeaway.
     */
    keyCoachingPoint: jsonb('key_coaching_point').$type<FeedbackStatement>(),

    /**
     * HiddenInsight.key values that the salesperson
     * successfully uncovered.
     */
    discoveredInsightKeys: jsonb('discovered_insight_keys')
      .$type<string[]>()
      .default([])
      .notNull(),

    /**
     * Important HiddenInsight.key values that remained
     * undiscovered.
     */
    missedInsightKeys: jsonb('missed_insight_keys')
      .$type<string[]>()
      .default([])
      .notNull(),

    /**
     * Whether the Practice Card objective was achieved.
     * Displayed next to the score; does not change it.
     */
    objectiveOutcome: objectiveOutcomeEnum('objective_outcome'),

    objectiveFeedback: text('objective_feedback'),

    objectiveEvidence: jsonb('objective_evidence')
      .$type<EvaluationEvidence[]>()
      .notNull(),

    /**
     * One entry per ObjectionSpec.key in the agent config.
     */
    objectionOutcomes: jsonb('objection_outcomes')
      .$type<ObjectionOutcome[]>()
      .default([])
      .notNull(),

    nextPracticeRecommendation: jsonb(
      'next_practice_recommendation',
    ).$type<LearningRecommendation>(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'practice_evaluation_score_check',
      sql`${table.overallScore} >= 0 AND ${table.overallScore} <= 100`,
    ),
  ],
)

/* =========================================================
 * SESSION COMPETENCY SCORES
 *
 * Score for each scorecard criterion in this session.
 * ======================================================= */

export const practiceSessionCompetencyScores = pgTable(
  'practice_session_competency_scores',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => practiceSessions.id, {
        onDelete: 'cascade',
      }),

    competencyId: uuid('competency_id')
      .notNull()
      .references(() => competencies.id, {
        onDelete: 'restrict',
      }),

    score: integer('score'),

    /** Missing behavior counts only when a real opportunity existed. */
    assessmentStatus: text('assessment_status')
      .$type<AssessmentStatus>()
      .notNull(),

    feedback: text('feedback'),

    /**
     * Evidence supporting the score.
     */
    evidence: jsonb('evidence')
      .$type<EvaluationEvidence[]>()
      .default([])
      .notNull(),

    findings: jsonb('findings').$type<BehavioralFinding[]>().notNull(),
    scoringRubric: jsonb('scoring_rubric').$type<CompetencyRubric>().notNull(),
    scoreExplanation: jsonb('score_explanation').$type<ScoreExplanation>(),

    /** Claimed atomically with the learner profile update; scores stay immutable. */
    profileAppliedAt: timestamp('profile_applied_at', { withTimezone: true }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sessionId, table.competencyId],
    }),

    check(
      'practice_competency_score_check',
      sql`${table.score} >= 0 AND ${table.score} <= 100`,
    ),
    check(
      'practice_competency_assessment_check',
      sql`(${table.assessmentStatus} = 'not_assessed' AND ${table.score} IS NULL) OR (${table.assessmentStatus} IN ('observed', 'opportunity_missed') AND ${table.score} IS NOT NULL)`,
    ),

    index('session_competency_competency_idx').on(table.competencyId),
  ],
)

/* =========================================================
 * LEARNER COMPETENCY PROFILE
 *
 * Persistent skill profile used for personalized learning.
 * ======================================================= */

export const learnerCompetencyProfiles = pgTable(
  'learner_competency_profiles',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    competencyId: uuid('competency_id')
      .notNull()
      .references(() => competencies.id, {
        onDelete: 'restrict',
      }),

    /**
     * Estimated current skill level: 0-100.
     */
    masteryScore: integer('mastery_score'),

    /** Applied score records, not validated observations or calibrated confidence. */
    evidenceCount: integer('evidence_count').default(0).notNull(),

    lastPracticedAt: timestamp('last_practiced_at', {
      withTimezone: true,
    }),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.userId, table.competencyId],
    }),

    check(
      'learner_mastery_score_check',
      sql`${table.masteryScore} IS NULL OR (${table.masteryScore} >= 0 AND ${table.masteryScore} <= 100)`,
    ),

    index('learner_competency_skill_idx').on(table.competencyId),
  ],
)

/* =========================================================
 * USER ACTIVITY DAYS
 *
 * One row per user per calendar day (Asia/Ho_Chi_Minh) with
 * an authenticated visit. Better Auth deletes `session` rows
 * on sign-out and expiry, so they cannot answer "who was
 * signed in on day X".
 * ======================================================= */

export const userActivityDays = pgTable(
  'user_activity_days',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    activityDate: date('activity_date').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.activityDate],
    }),

    index('user_activity_days_date_idx').on(table.activityDate),
  ],
)

/* =========================================================
 * SERVICE USAGE
 *
 * What the STT, LLM and TTS providers consumed for a call or an evaluation,
 * one row per service, provider and model. Prices are applied when read, so
 * a corrected price also corrects past costs.
 * ======================================================= */

export const serviceUsage = pgTable(
  'service_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    /** No foreign key: provider costs outlive purged practice sessions. */
    sessionId: uuid('session_id').notNull(),

    /** The voice attempt for a call; one id per request for an evaluation. */
    usageKey: uuid('usage_key').notNull(),

    /** 'conversation' or 'evaluation'. */
    source: varchar('source', { length: 16 }).notNull(),

    /** 'stt', 'llm' or 'tts'. */
    service: varchar('service', { length: 8 }).notNull(),
    provider: varchar('provider', { length: 64 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),

    audioMs: bigint('audio_ms', { mode: 'number' }).default(0).notNull(),
    characters: bigint('characters', { mode: 'number' }).default(0).notNull(),
    /** Includes the cached input tokens. */
    inputTokens: bigint('input_tokens', { mode: 'number' })
      .default(0)
      .notNull(),
    cachedInputTokens: bigint('cached_input_tokens', { mode: 'number' })
      .default(0)
      .notNull(),
    outputTokens: bigint('output_tokens', { mode: 'number' })
      .default(0)
      .notNull(),

    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Redelivered voice events and retried writes record usage once.
    uniqueIndex('service_usage_key_service_unique').on(
      table.usageKey,
      table.service,
      table.provider,
      table.model,
    ),
    index('service_usage_session_idx').on(table.sessionId),
    index('service_usage_recorded_idx').on(table.recordedAt),
    check(
      'service_usage_amounts_valid',
      sql`${table.audioMs} >= 0 AND ${table.characters} >= 0 AND ${table.inputTokens} >= 0 AND ${table.cachedInputTokens} >= 0 AND ${table.cachedInputTokens} <= ${table.inputTokens} AND ${table.outputTokens} >= 0`,
    ),
  ],
)

/* =========================================================
 * INFERRED TYPES
 * ======================================================= */

export type Competency = typeof competencies.$inferSelect
export type NewCompetency = typeof competencies.$inferInsert

export type SalesOffering = typeof salesOfferings.$inferSelect
export type NewSalesOffering = typeof salesOfferings.$inferInsert

export type Practice = typeof practices.$inferSelect
export type NewPractice = typeof practices.$inferInsert

export type PracticeAgentConfigRow = typeof practiceAgentConfigs.$inferSelect

export type NewPracticeAgentConfigRow = typeof practiceAgentConfigs.$inferInsert

export type PracticeCompetency = typeof practiceCompetencies.$inferSelect

export type PracticeSession = typeof practiceSessions.$inferSelect

export type NewPracticeSession = typeof practiceSessions.$inferInsert

export type PracticeSessionTurn = typeof practiceSessionTurns.$inferSelect

export type NewPracticeSessionTurn = typeof practiceSessionTurns.$inferInsert

export type PracticeSessionEvaluation =
  typeof practiceSessionEvaluations.$inferSelect

export type PracticeSessionCompetencyScore =
  typeof practiceSessionCompetencyScores.$inferSelect

export type LearnerCompetencyProfile =
  typeof learnerCompetencyProfiles.$inferSelect
