import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '#/db'
import {
  competencies,
  practiceAgentConfigs,
  practiceCompetencies,
  practices,
  salesOfferings,
} from '#/db/schema'
import type {
  BuyerField,
  BuyerProfile,
  LearnerBriefView,
  LearnerBuyerCard,
  PracticeType,
  Practice,
  PracticeAgentConfig,
  CompetencyRubric,
  SalesOfferingConfig,
} from '#/db/schema'
import {
  agentConfigSchema,
  learnerBriefSchema,
  rubricSchema,
  salesOfferingSchema,
} from '#/lib/practice/validation'
import type {
  ParsedAgentConfig,
  ParsedLearnerBrief,
} from '#/lib/practice/validation'
import { formatCurrency } from '#/lib/practice/currency'
import { canManageWorkspacePractices } from '#/lib/auth/workspace-roles'
import { getWorkspaceForUser } from './workspaces'

export type PracticeDatabase =
  typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export type RuntimePractice = {
  practice: Practice
  config: PracticeAgentConfig
  learnerBrief: LearnerBriefView
  offering: SalesOfferingConfig
  competencies: Array<{
    id: string
    code: string
    name: string
    description: string | null
    weight: number
    rubric: CompetencyRubric
  }>
}

const scorecardOrder: Record<PracticeType, string[]> = {
  cold_call: [
    'opening_hook',
    'needs_discovery',
    'value_articulation',
    'objection_handling',
    'next_step_closing',
  ],
  warm_call: [
    'reconnect_agenda',
    'needs_discovery',
    'value_articulation',
    'objection_handling',
    'next_step_closing',
  ],
}

function orderScorecard<T extends { code: string }>(
  type: PracticeType,
  items: T[],
) {
  const order = scorecardOrder[type]
  return items.sort((a, b) => {
    const aIndex = order.indexOf(a.code)
    const bIndex = order.indexOf(b.code)
    return (
      (aIndex < 0 ? order.length : aIndex) -
      (bIndex < 0 ? order.length : bIndex)
    )
  })
}

export async function getLearnerPracticeCompetencies(
  id: string,
  type: PracticeType,
) {
  const items = await db
    .select({
      id: competencies.id,
      code: competencies.code,
      name: competencies.name,
      description: competencies.description,
      weight: practiceCompetencies.weight,
    })
    .from(practiceCompetencies)
    .innerJoin(
      competencies,
      eq(practiceCompetencies.competencyId, competencies.id),
    )
    .where(eq(practiceCompetencies.practiceId, id))
  return orderScorecard(type, items)
}

function productLabel(offering: SalesOfferingConfig) {
  const productNames: Record<SalesOfferingConfig['productType'], string> = {
    apartment: 'Căn hộ',
    townhouse: 'Nhà phố',
    villa: 'Biệt thự',
    shophouse: 'Shophouse',
    land: 'Đất nền',
    other: 'Bất động sản',
  }
  const unit =
    offering.productType === 'apartment' && offering.unit.bedrooms
      ? `Căn ${offering.unit.bedrooms}PN`
      : productNames[offering.productType]
  const price = formatCurrency(offering.price.amount, offering.price.currency)
  return `${unit} · ${offering.unit.areaM2} m² · ${offering.projectName} · ${price}`
}

const identityFields = [
  'age',
  'occupation',
  'familySituation',
  'emotionalState',
] as const

function isDisclosed(field: string, learnerKnows: BuyerField[]) {
  return learnerKnows.some(
    (known) => field === known || field.startsWith(`${known}.`),
  )
}

export function projectBuyerCard(
  buyer: BuyerProfile,
  learnerKnows: BuyerField[],
): LearnerBuyerCard {
  const card: LearnerBuyerCard = {
    name: buyer.name,
    addressTerm: buyer.addressTerm,
  }
  for (const field of identityFields)
    if (isDisclosed(field, learnerKnows))
      Object.assign(card, { [field]: buyer[field] })
  const known: Record<string, unknown> = {}
  for (const path of learnerKnows) {
    if ((identityFields as readonly string[]).includes(path)) continue
    const [parent, child] = path.split('.') as [
      keyof BuyerProfile,
      string | undefined,
    ]
    const value = buyer[parent]
    if (!child) {
      if (parent === 'budget' || parent === 'urgency') {
        const disclosed = { ...(value as Record<string, unknown>) }
        delete disclosed[parent === 'budget' ? 'detail' : 'driver']
        known[parent] = disclosed
      } else known[parent] = value
    } else {
      const target = (known[parent] ??= {}) as Record<string, unknown>
      target[child] = (value as Record<string, unknown>)[child]
      if (parent === 'budget') target.currency = buyer.budget.currency
    }
  }
  if (Object.keys(known).length) card.known = known
  return card
}

export function learnerBriefView(
  brief: ParsedLearnerBrief,
  config: ParsedAgentConfig,
): LearnerBriefView {
  return {
    ...brief,
    buyer: projectBuyerCard(config.buyer, config.learnerKnows),
  }
}

export function practiceAccess(workspaceId: string) {
  return or(
    and(
      eq(practices.isGlobal, true),
      isNull(practices.workspaceId),
      isNull(practices.createdByUserId),
    ),
    and(eq(practices.isGlobal, false), eq(practices.workspaceId, workspaceId)),
  )
}

export function offeringAccess(workspaceId: string) {
  return or(
    and(eq(salesOfferings.isGlobal, true), isNull(salesOfferings.workspaceId)),
    and(
      eq(salesOfferings.isGlobal, false),
      eq(salesOfferings.workspaceId, workspaceId),
    ),
  )
}

export async function listLearnerPractices(
  userId: string,
  workspaceId: string,
) {
  const workspace = await getWorkspaceForUser(userId, workspaceId)
  const canManage = canManageWorkspacePractices(
    workspace?.kind,
    workspace?.role,
  )
  const rows = await db
    .select({
      id: practices.id,
      createdByUserId: practices.createdByUserId,
      slug: practices.slug,
      type: practices.type,
      title: practices.title,
      description: practices.description,
      difficulty: practices.difficulty,
      locale: practices.locale,
      estimatedMinutes: practices.estimatedMinutes,
      learnerBrief: practices.learnerBrief,
      learnerInstructions: practices.learnerInstructions,
      offering: salesOfferings.offering,
      agentConfig: practiceAgentConfigs.config,
    })
    .from(practices)
    .innerJoin(salesOfferings, eq(practices.salesOfferingId, salesOfferings.id))
    .innerJoin(
      practiceAgentConfigs,
      eq(practiceAgentConfigs.practiceId, practices.id),
    )
    .where(
      and(
        eq(practices.status, 'published'),
        practiceAccess(workspaceId),
        offeringAccess(workspaceId),
      ),
    )
    .orderBy(asc(practices.type), asc(practices.createdAt), asc(practices.slug))
  const links = await db
    .select({
      practiceId: practiceCompetencies.practiceId,
      id: competencies.id,
      code: competencies.code,
      name: competencies.name,
      description: competencies.description,
      weight: practiceCompetencies.weight,
    })
    .from(practiceCompetencies)
    .innerJoin(
      competencies,
      eq(practiceCompetencies.competencyId, competencies.id),
    )
    .where(
      inArray(
        practiceCompetencies.practiceId,
        rows.length
          ? rows.map((row) => row.id)
          : ['00000000-0000-0000-0000-000000000000'],
      ),
    )
  return rows.map(({ agentConfig, createdByUserId, ...row }) => {
    const learnerBrief = learnerBriefView(
      learnerBriefSchema.parse(row.learnerBrief),
      agentConfigSchema.parse(agentConfig),
    )
    const offering = salesOfferingSchema.parse(row.offering)
    const competenciesForPractice = orderScorecard(
      row.type,
      links.filter((link) => link.practiceId === row.id),
    ).map(({ id, code, name, description, weight }) => ({
      id,
      code,
      name,
      description,
      weight,
    }))
    return {
      ...row,
      isCustom: createdByUserId !== null,
      // Global practices have no author; workspace practices always do.
      canDelete: canManage && createdByUserId !== null,
      learnerBrief,
      offering,
      competencies: competenciesForPractice,
      catalog: {
        productLabel: productLabel(offering),
        scorecard: competenciesForPractice.map(({ code, name }) => ({
          code,
          name,
        })),
      },
    }
  })
}

export async function getLearnerPractice(
  id: string,
  userId: string,
  workspaceId: string,
) {
  const all = await listLearnerPractices(userId, workspaceId)
  return all.find((practice) => practice.id === id) ?? null
}

// Omit scope only from trusted seed/admin scripts, never from a request handler.
export async function getRuntimePractice(
  id: string,
  scope?: { userId: string; workspaceId: string },
  database: PracticeDatabase = db,
): Promise<RuntimePractice | null> {
  const practice = await database.query.practices.findFirst({
    where: and(
      eq(practices.id, id),
      scope ? practiceAccess(scope.workspaceId) : undefined,
    ),
  })
  if (!practice) return null
  const agent = await database.query.practiceAgentConfigs.findFirst({
    where: eq(practiceAgentConfigs.practiceId, id),
  })
  if (!agent) throw new Error('Practice agent config missing')
  const config = agentConfigSchema.parse(agent.config)
  const storedBrief = learnerBriefSchema.parse(practice.learnerBrief)
  assertCallContent(practice.type, storedBrief, config)
  const learnerBrief = learnerBriefView(storedBrief, config)
  const offeringRow = await database.query.salesOfferings.findFirst({
    where: and(
      eq(salesOfferings.id, practice.salesOfferingId),
      scope ? offeringAccess(scope.workspaceId) : undefined,
    ),
  })
  if (!offeringRow) throw new Error('Sales offering missing')
  const offering = salesOfferingSchema.parse(offeringRow.offering)
  const mappings = await database
    .select({
      id: competencies.id,
      code: competencies.code,
      name: competencies.name,
      description: competencies.description,
      weight: practiceCompetencies.weight,
      rubric: practiceCompetencies.rubric,
    })
    .from(practiceCompetencies)
    .innerJoin(
      competencies,
      eq(practiceCompetencies.competencyId, competencies.id),
    )
    .where(eq(practiceCompetencies.practiceId, id))
  const scored = mappings.map((item) => ({
    ...item,
    rubric: rubricSchema.parse(item.rubric),
  }))
  if (
    !scored.length ||
    scored.reduce((total, item) => total + item.weight, 0) !== 100
  )
    throw new Error('Practice competency weights must total 100')
  if (practice.estimatedMinutes != null && practice.estimatedMinutes <= 0)
    throw new Error('Invalid practice duration')
  return {
    practice,
    config,
    learnerBrief,
    offering,
    competencies: scored,
  }
}

function assertCallContent(
  type: PracticeType,
  brief: ParsedLearnerBrief,
  config: ParsedAgentConfig,
) {
  if (config.kind !== type)
    throw new Error('Practice type does not match agent config')
  const insightKeys = config.hiddenInsights.map((item) => item.key)
  if (new Set(insightKeys).size !== insightKeys.length)
    throw new Error('Duplicate hidden insight key')
  const objectionKeys = config.objections.map((item) => item.key)
  if (new Set(objectionKeys).size !== objectionKeys.length)
    throw new Error('Duplicate objection key')
  const interactions = brief.previousInteractions ?? []
  if (type === 'warm_call' && !interactions.length)
    throw new Error('Warm call requires previous interactions')
  if (type === 'cold_call' && interactions.length)
    throw new Error('Cold call cannot have previous interactions')
  const knows = config.learnerKnows
  if (new Set(knows).size !== knows.length)
    throw new Error('Duplicate learnerKnows field')
  for (const field of knows) {
    if (knows.some((other) => other !== field && field.startsWith(`${other}.`)))
      throw new Error(`learnerKnows "${field}" is covered by its parent`)
    const [parent, child] = field.split('.') as [keyof BuyerProfile, string?]
    const value = config.buyer[parent] as unknown
    const resolved = child
      ? (value as Record<string, unknown> | undefined)?.[child]
      : value
    if (resolved == null)
      throw new Error(`learnerKnows "${field}" has no buyer value`)
  }
  for (const insight of config.hiddenInsights)
    if (insight.relatesTo && isDisclosed(insight.relatesTo, knows))
      throw new Error(
        `Hidden insight "${insight.key}" relates to a field the learner already knows`,
      )
}

export async function publishPractice(id: string) {
  const runtime = await getRuntimePractice(id)
  if (!runtime || !runtime.practice.title.trim())
    throw new Error('Practice is incomplete')
  if (runtime.practice.status !== 'draft')
    throw new Error('Only drafts can be published')
  const [published] = await db
    .update(practices)
    .set({
      status: 'published',
      publishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(practices.id, id), eq(practices.status, 'draft')))
    .returning()
  return published
}

export async function archivePractice(id: string) {
  await db
    .update(practices)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(practices.id, id), eq(practices.status, 'published')))
}

export async function duplicatePractice(id: string, slug: string) {
  const source = await getRuntimePractice(id)
  if (!source) throw new Error('Practice not found')
  return db.transaction(async (tx) => {
    const [copy] = await tx
      .insert(practices)
      .values({
        slug,
        workspaceId: source.practice.workspaceId,
        isGlobal: source.practice.isGlobal,
        createdByUserId: source.practice.createdByUserId,
        type: source.practice.type,
        title: source.practice.title,
        description: source.practice.description,
        status: 'draft',
        difficulty: source.practice.difficulty,
        locale: source.practice.locale,
        estimatedMinutes: source.practice.estimatedMinutes,
        tags: source.practice.tags,
        learnerBrief: source.practice.learnerBrief,
        salesOfferingId: source.practice.salesOfferingId,
        learnerInstructions: source.practice.learnerInstructions,
      })
      .returning()
    await tx.insert(practiceAgentConfigs).values({
      practiceId: copy.id,
      config: source.config,
    })
    for (const mapping of source.competencies)
      await tx.insert(practiceCompetencies).values({
        practiceId: copy.id,
        competencyId: mapping.id,
        weight: mapping.weight,
        rubric: mapping.rubric,
      })
    return copy
  })
}
