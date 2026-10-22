import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as XLSX from '@e965/xlsx'
import {
  createPracticeTemplateWorkbook,
  readPracticeWorkbook,
  templateDraft,
} from './workbook'
import {
  defaultScorecard,
  draftPayload,
  fieldsForDraft,
  flattenValues,
  scorecardFields,
  validateDraft,
} from './authoring'
import type { PracticeDraft } from './authoring'
import { SCORECARD_TEMPLATES } from './scorecards'

async function bytes() {
  const workbook = await createPracticeTemplateWorkbook()
  return XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  }) as ArrayBuffer
}
function editWorkbook(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    'Bai luyen',
  )
  return XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  }) as ArrayBuffer
}
const header = ['Nhóm', 'Mã trường', 'Thông tin', 'Giá trị', 'Hướng dẫn']
function draftRows(draft: PracticeDraft): unknown[][] {
  return [
    header,
    ...fieldsForDraft(draft).map((field) => [
      '',
      field.key,
      field.label,
      draft[field.key] ?? '',
    ]),
  ]
}
test('downloaded one-sheet template imports a complete practice with scorecard and hidden content', async () => {
  const workbook = await createPracticeTemplateWorkbook()
  assert.deepEqual(workbook.SheetNames, ['Bai luyen'])
  const imported = await readPracticeWorkbook(await bytes())
  const result = validateDraft(imported)
  assert.deepEqual(result.errors, {})
  assert.equal(result.result.success, true)
  assert.equal(result.result.data.offering.price.amount, 3900000000)
  assert.equal(result.result.data.offering.asOf, '2026-10')
  assert.equal(result.result.data.config.hiddenInsights[0].key, 'lease_ends')
  assert.equal(result.result.data.config.objections[0].category, 'brush_off')
  assert.equal(
    result.result.data.scorecard.reduce((sum, item) => sum + item.weight, 0),
    100,
  )
  assert.deepEqual(
    result.result.data.scorecard.map((item) => item.rubric),
    SCORECARD_TEMPLATES.cold_call.map((item) => item.defaultRubric),
  )
})
test('offering month typed into Excel as a date imports as YYYY-MM', async () => {
  const rows = draftRows(templateDraft()).map((row) =>
    row[1] === 'offering.asOf' ? [...row.slice(0, 3), 46296] : row,
  )
  const imported = await readPracticeWorkbook(editWorkbook(rows))
  assert.equal(imported['offering.asOf'], '2026-10')
  assert.equal(validateDraft(imported).result.success, true)
  assert.equal(
    validateDraft({ ...templateDraft(), 'offering.asOf': '10/2026' }).errors[
      'offering.asOf'
    ],
    'Vui lòng nhập giá trị hợp lệ.',
  )
})
test('both starter scorecards use explicit anchored levels and critical-error caps', () => {
  for (const criteria of Object.values(SCORECARD_TEMPLATES)) {
    for (const criterion of criteria) {
      const rubric = criterion.defaultRubric
      assert.deepEqual(
        rubric.levels.map((level) => level.score),
        [0, 40, 70, 90, 100],
      )
      assert.deepEqual(rubric.levels[0].requiredBehaviorIds, [])
      for (const level of rubric.levels.slice(1)) {
        assert.ok(level.requiredBehaviorIds.length > 0)
        assert.ok(
          level.requiredBehaviorIds.every((id) =>
            rubric.behaviors.some((behavior) => behavior.id === id),
          ),
        )
      }
      assert.ok(
        rubric.criticalErrors.every((error) =>
          Number.isInteger(error.scoreCap),
        ),
      )
      assert.equal(
        rubric.criticalErrors.find((error) => error.id === 'fabricated_promise')
          ?.scoreCap,
        0,
      )
      assert.equal(
        rubric.criticalErrors.find(
          (error) => error.id === 'false_product_facts',
        )?.scoreCap,
        40,
      )
    }
  }
})
test('custom rubric IDs, levels, caps and row counts roundtrip without starter row resurrection', async () => {
  const rubric = {
    description: 'Hướng dẫn riêng của người huấn luyện',
    behaviors: [
      { id: 'trainer_intro', description: 'Giới thiệu đúng danh tính.' },
      {
        id: 'trainer_permission',
        description: 'Xin phép trước khi trình bày.',
      },
    ],
    levels: [
      { id: 'baseline', label: 'Chưa đạt', score: 0, requiredBehaviorIds: [] },
      {
        id: 'intro',
        label: 'Giới thiệu',
        score: 55,
        requiredBehaviorIds: ['trainer_intro'],
      },
      {
        id: 'permission',
        label: 'Đầy đủ',
        score: 100,
        requiredBehaviorIds: ['trainer_intro', 'trainer_permission'],
      },
    ],
    criticalErrors: [
      {
        id: 'trainer_pressure',
        description: 'Gây áp lực sau từ chối.',
        scoreCap: 25,
      },
    ],
  }
  const draft = templateDraft()
  for (const key of Object.keys(draft))
    if (key.startsWith('scorecard.0.rubric.')) delete draft[key]
  Object.assign(draft, flattenValues(rubric, 'scorecard.0.rubric'))
  const fields = scorecardFields('cold_call', draft)
  assert.ok(
    fields.some(
      (field) =>
        field.key === 'scorecard.0.rubric.levels.2.requiredBehaviorIds',
    ),
  )
  assert.ok(
    !fields.some((field) =>
      field.key.startsWith('scorecard.0.rubric.behaviors.2.'),
    ),
  )
  const imported = await readPracticeWorkbook(editWorkbook(draftRows(draft)))
  const result = validateDraft(imported)
  assert.equal(result.result.success, true)
  assert.deepEqual(result.result.data.scorecard[0].rubric, rubric)
  for (const key of Object.keys(draft))
    if (key.startsWith('scorecard.0.rubric.criticalErrors.')) delete draft[key]
  const noCaps = validateDraft(
    await readPracticeWorkbook(editWorkbook(draftRows(draft))),
  )
  assert.equal(noCaps.result.success, true)
  assert.deepEqual(noCaps.result.data.scorecard[0].rubric.criticalErrors, [])
})
test('additional authored behavior rows and cap edits survive workbook import', async () => {
  const draft = {
    ...templateDraft(),
    'scorecard.0.rubric.behaviors.4.id': 'confirm_interest',
    'scorecard.0.rubric.behaviors.4.description':
      'Hỏi xác nhận khách muốn tiếp tục.',
    'scorecard.0.rubric.levels.4.requiredBehaviorIds':
      'identify_self\nrelevant_source\nask_permission\nset_brief_scope\nconfirm_interest',
    'scorecard.0.rubric.criticalErrors.0.scoreCap': '25',
  }
  const result = validateDraft(
    await readPracticeWorkbook(editWorkbook(draftRows(draft))),
  )
  assert.equal(result.result.success, true)
  assert.equal(
    result.result.data.scorecard[0].rubric.behaviors[4].id,
    'confirm_interest',
  )
  assert.equal(
    result.result.data.scorecard[0].rubric.criticalErrors[0].scoreCap,
    25,
  )
  assert.deepEqual(
    result.result.data.scorecard[0].rubric.levels[4].requiredBehaviorIds,
    draft['scorecard.0.rubric.levels.4.requiredBehaviorIds'].split('\n'),
  )
})
test('rubric validation rejects invalid IDs, score anchors and caps', () => {
  const mutations: Record<string, string>[] = [
    { 'scorecard.0.rubric.behaviors.1.id': 'identify_self' },
    { 'scorecard.0.rubric.levels.1.id': 'none' },
    { 'scorecard.0.rubric.criticalErrors.1.id': 'missing_identity' },
    { 'scorecard.0.rubric.levels.1.requiredBehaviorIds': 'unknown_behavior' },
    {
      'scorecard.0.rubric.levels.1.requiredBehaviorIds':
        'identify_self\nidentify_self',
    },
    { 'scorecard.0.rubric.levels.0.requiredBehaviorIds': 'identify_self' },
    { 'scorecard.0.rubric.levels.1.requiredBehaviorIds': '' },
    { 'scorecard.0.rubric.levels.0.score': '1' },
    { 'scorecard.0.rubric.levels.1.score': '70' },
    { 'scorecard.0.rubric.levels.1.score': '95' },
    { 'scorecard.0.rubric.levels.1.score': '40.5' },
    { 'scorecard.0.rubric.criticalErrors.0.scoreCap': '-1' },
    { 'scorecard.0.rubric.criticalErrors.0.scoreCap': '101' },
  ]
  for (const changes of mutations) {
    assert.equal(
      validateDraft({ ...templateDraft(), ...changes }).result.success,
      false,
    )
  }
  const noBehaviors = templateDraft()
  for (const key of Object.keys(noBehaviors))
    if (key.startsWith('scorecard.0.rubric.behaviors.')) delete noBehaviors[key]
  assert.equal(validateDraft(noBehaviors).result.success, false)
  const baselineOnly = templateDraft()
  for (const key of Object.keys(baselineOnly))
    if (
      key.startsWith('scorecard.0.rubric.levels.') &&
      !key.startsWith('scorecard.0.rubric.levels.0.')
    )
      delete baselineOnly[key]
  assert.equal(validateDraft(baselineOnly).result.success, false)
  const draft = templateDraft()
  for (const key of Object.keys(draft))
    if (key.startsWith('scorecard.0.rubric.levels.')) delete draft[key]
  assert.equal(validateDraft(draft).result.success, false)
  assert.ok(
    !scorecardFields('cold_call', draft).some((field) =>
      field.key.startsWith('scorecard.0.rubric.levels.'),
    ),
  )
})
test('warm call requires previous interaction and changed situation; cold call omits stale warm fields', () => {
  const draft = {
    ...Object.fromEntries(
      Object.entries(templateDraft()).filter(
        ([key]) => !key.startsWith('scorecard.'),
      ),
    ),
    type: 'warm_call',
    ...defaultScorecard('warm_call'),
  }
  assert.ok(
    validateDraft(draft).errors['learnerBrief.previousInteractions.0.when'],
  )
  assert.ok(validateDraft(draft).errors['config.sinceLastContact'])
  Object.assign(draft, {
    'config.sinceLastContact': 'Chồng lo lãi suất.',
    'learnerBrief.previousInteractions.0.when': 'Tuần trước',
    'learnerBrief.previousInteractions.0.channel': 'phone',
    'learnerBrief.previousInteractions.0.summary': 'Đã gửi bảng giá.',
  })
  assert.equal(validateDraft(draft).result.success, true)
  assert.equal(
    validateDraft({
      ...Object.fromEntries(
        Object.entries(draft).filter(([key]) => !key.startsWith('scorecard.')),
      ),
      type: 'cold_call',
      ...defaultScorecard('cold_call'),
    }).result.success,
    true,
  )
  assert.equal(
    (
      draftPayload({ ...draft, type: 'cold_call' }) as {
        learnerBrief: { previousInteractions?: unknown }
      }
    ).learnerBrief.previousInteractions,
    undefined,
  )
})
test('import preserves missing fields for form validation and custom scorecard weights', async () => {
  const imported = await readPracticeWorkbook(
    editWorkbook([
      header,
      ['', 'title', '', 'Bài luyện của tôi'],
      ['', 'scorecard.0.weight', '', 35],
    ]),
  )
  assert.equal(imported.title, 'Bài luyện của tôi')
  assert.equal(imported['scorecard.0.weight'], '35')
  assert.equal(validateDraft(imported).result.success, false)
})
test('rejects bad headers, duplicate and unknown fields, noncontiguous rows and unsafe property paths', async () => {
  for (const rows of [
    [['Không đúng mẫu']],
    [header, ['', 'title', '', 'a'], ['', 'title', '', 'b']],
    [header, ['', 'unknown', '', 'x']],
    [header, ['', 'config.hiddenInsights.9.key', '', 'x']],
    [header, ['', 'scorecard.0.rubric.behaviors.9.id', '', 'invalid_gap']],
    [header, ['', 'scorecard.0.rubric.levels.9.id', '', 'invalid_gap']],
    [header, ['', 'scorecard.0.rubric.criticalErrors.9.id', '', 'invalid_gap']],
    [header, ['', 'scorecard.0.rubric.positiveIndicators', '', 'obsolete']],
    [header, ['', 'scorecard.0.rubric.negativeIndicators', '', 'obsolete']],
    [header, ['', '__proto__.title', '', 'x']],
  ]) {
    await assert.rejects(() => readPracticeWorkbook(editWorkbook(rows)))
  }
})
test('rejects formulas, Excel errors, multiple sheets, oversized and unreadable workbooks', async () => {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet([header, ['', 'title', '', 'unsafe']])
  sheet.D2 = { t: 's', v: 'unsafe', f: '1+1' }
  XLSX.utils.book_append_sheet(workbook, sheet, 'Bai luyen')
  await assert.rejects(
    () =>
      readPracticeWorkbook(
        XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }),
      ),
    /công thức/,
  )
  sheet.D2 = { t: 'e', v: 7 }
  await assert.rejects(
    () =>
      readPracticeWorkbook(
        XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }),
      ),
    /lỗi Excel/,
  )
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['Extra']]),
    'Extra',
  )
  await assert.rejects(
    () =>
      readPracticeWorkbook(
        XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }),
      ),
    /một sheet/,
  )
  await assert.rejects(
    () => readPracticeWorkbook(new ArrayBuffer(5 * 1024 * 1024 + 1)),
    /5 MB/,
  )
  await assert.rejects(() =>
    readPracticeWorkbook(new Uint8Array([1, 2, 3]).buffer),
  )
})
test('validation rejects invalid score weights, budgets, duplicate keys and disclosed hidden insights', () => {
  assert.ok(
    validateDraft({ ...templateDraft(), 'scorecard.0.weight': '99' }).errors
      .scorecard,
  )
  assert.ok(
    validateDraft({
      ...templateDraft(),
      'config.buyer.budget.min': '9999999999',
    }).errors['config.buyer.budget.min'],
  )
  assert.ok(
    validateDraft({ ...templateDraft(), 'config.learnerKnows': 'age\nurgency' })
      .errors['config.hiddenInsights.0.relatesTo'],
  )
  const draft = templateDraft()
  for (const [key, value] of Object.entries(draft))
    if (key.startsWith('config.hiddenInsights.0.'))
      draft[key.replace('.0.', '.1.')] = value
  assert.ok(validateDraft(draft).errors['config.hiddenInsights'])
})
