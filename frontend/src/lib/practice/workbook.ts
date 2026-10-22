import * as XLSX from '@e965/xlsx'
import {
  defaultScorecard,
  emptyDraft,
  fieldsForDraft,
  repeatFields,
  repeatIndexes,
  rubricRepeatFields,
} from './authoring'
import type { PracticeDraft } from './authoring'

export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024
export function templateDraft(): PracticeDraft {
  return {
    ...emptyDraft(),
    title: 'Gọi lần đầu - Anh Minh',
    description:
      'Gọi cho khách vừa để lại số trên landing page, hẹn xem nhà mẫu.',
    'learnerBrief.background':
      'Anh Minh để lại số điện thoại trên landing page The Paris - Vinhomes Ocean Park tối qua. Đây là lần đầu bạn gọi cho anh.',
    'learnerBrief.leadSource': 'Form đăng ký nhận bảng giá trên Facebook Ads',
    'learnerBrief.objective':
      'Hẹn được anh Minh và vợ đến xem nhà mẫu vào một ngày giờ cụ thể.',
    'offering.projectName': 'Vinhomes Ocean Park 1 - The Paris',
    'offering.developer': 'Vinhomes (liên doanh với Mitsubishi Corporation)',
    'offering.location.district': 'Gia Lâm',
    'offering.location.city': 'Hà Nội',
    'offering.unit.bedrooms': '2',
    'offering.unit.bathrooms': '2',
    'offering.unit.areaM2': '65',
    'offering.unit.floor': 'Tầng 18, tòa PR5 The Inspire',
    'offering.unit.view': 'Hướng hồ nội khu',
    'offering.unit.furnishing': 'Bàn giao nội thất cơ bản',
    'offering.price.amount': '3900000000',
    'offering.price.note':
      'Giá chủ đầu tư, đã gồm VAT, chưa gồm phí bảo trì 2%',
    'offering.paymentPlan.summary':
      'Thanh toán tối đa 50% trước khi nhận nhà, chia thành các đợt nhỏ 2–3% theo tiến độ xây dựng; hoặc vay ngân hàng đến 70%.',
    'offering.paymentPlan.loanSupport':
      'Vay đến 70% giá trị căn hộ, hỗ trợ lãi suất 0% và ân hạn nợ gốc 24 tháng; sau đó lãi suất thả nổi theo ngân hàng.',
    'offering.handover': 'Dự kiến quý I/2027',
    'offering.legalStatus': 'Sở hữu lâu dài, sổ hồng cấp sau khi bàn giao',
    'offering.asOf': '2026-10',
    'offering.keyStrengths':
      'Mua trực tiếp chủ đầu tư, khoảng 60 triệu/m2, thấp hơn khoảng 5–10% so với căn 2PN chuyển nhượng đã có sổ trong cùng khu đô thị\nTiến độ thanh toán giãn, tối đa 50% trước khi nhận nhà',
    'offering.keyWeaknesses':
      'Chưa có sổ hồng, phải chờ sau bàn giao\nĐường vào trung tâm qua cầu Vĩnh Tuy, Thanh Trì hay kẹt xe giờ cao điểm\nHết 24 tháng hỗ trợ, lãi suất thả nổi theo ngân hàng',
    'config.buyer.name': 'Minh',
    'config.buyer.age': '34',
    'config.buyer.occupation': 'Kỹ sư phần mềm',
    'config.buyer.familySituation':
      'Đã có vợ và một con 3 tuổi, đang thuê nhà ở Long Biên',
    'config.buyer.motivation.detail':
      'Muốn mua căn hộ đầu tiên để ở trước khi con vào tiểu học.',
    'config.buyer.budget.min': '3400000000',
    'config.buyer.budget.max': '4200000000',
    'config.buyer.budget.fundingSource':
      'Tiết kiệm 1.300.000.000 VND, phần còn lại vay ngân hàng',
    'config.buyer.priorities':
      'Gần trường học cho con\nKhoản trả góp hàng tháng dưới 22 triệu\nPháp lý rõ ràng',
    'config.buyer.decisionMaker.role': 'joint_with_spouse',
    'config.buyer.decisionMaker.detail':
      'Vợ anh quyết định cùng, đặc biệt về vị trí.',
    'config.buyer.urgency.timeline': 'Trong 6 tháng tới',
    'config.buyer.emotionalState': 'guarded',
    'config.learnerKnows': 'age',
    'config.privateBackground':
      'Anh đã nhận nhiều cuộc gọi môi giới trong tuần và hơi mệt vì bị làm phiền. Đang bận làm việc lúc nhận cuộc gọi.',
    'config.recollection':
      'Tối qua lướt Facebook thấy quảng cáo và để lại số để xem bảng giá, nhưng không nhớ rõ tên dự án.',
    'config.behaviorRules':
      'Chỉ biết về sản phẩm những gì người gọi nói.\nKhông đồng ý mua hay đặt cọc trong cuộc gọi này.\nCởi mở hơn khi được hỏi về gia đình và nhu cầu.',
    'config.successCriteria':
      'Người gọi hẹn được ngày giờ cụ thể xem nhà mẫu.\nNgười gọi mời cả vợ anh Minh cùng đi.',
    'config.hiddenInsights.0.key': 'lease_ends',
    'config.hiddenInsights.0.insight':
      'Chủ nhà đã báo không gia hạn sau tháng 3.',
    'config.hiddenInsights.0.revealGuidance':
      'Chỉ nói khi được hỏi về thời điểm muốn chuyển nhà.',
    'config.hiddenInsights.0.relatesTo': 'urgency',
    'config.objections.0.key': 'busy_now',
    'config.objections.0.category': 'brush_off',
    'config.objections.0.sampleWording':
      'Anh đang bận, em gửi thông tin qua Zalo đi.',
    'config.objections.0.raiseGuidance':
      'Nêu ngay sau khi người gọi giới thiệu nếu chưa nói lý do gọi liên quan đến anh.',
    'config.objections.0.resolutionGuidance':
      'Dịu lại nếu người gọi nhắc đúng form anh đăng ký và xin 2 phút.',
  }
}
const HEADERS = ['Nhóm', 'Mã trường', 'Thông tin', 'Giá trị', 'Hướng dẫn']
export async function createPracticeTemplateWorkbook() {
  const sample = templateDraft()
  // Include optional warm-call and repeatable fields in the same worksheet.
  const layout = {
    ...sample,
    'learnerBrief.previousInteractions.0.when': '',
    'offering.paymentPlan.milestones.0.label': '',
    'offering.competitors.0.name': '',
  }
  const rows: (string | number)[][] = [
    ['MẪU BÀI LUYỆN · SALESCOACH AI'],
    [
      'Một file = một bài luyện. Sửa cột Giá trị; giữ nguyên Mã trường và hàng tiêu đề. Ví dụ dựa trên seed-practices.ts.',
    ],
    [
      'Danh sách: mỗi dòng một mục (Alt+Enter). Số: nhập số nguyên không có dấu phân cách. Điều kiện mức 0 để trống; không có lỗi thì xóa mọi hàng lỗi của kỹ năng.',
    ],
    [
      'Gọi lại: chọn warm_call, điền lịch sử trao đổi và thay đổi từ lần liên hệ trước. Gọi đầu tiên: chọn cold_call.',
    ],
    [
      'Thêm mục: sao chép các hàng của thông tin ẩn / phản đối / lịch sử / hành vi / mức điểm / lỗi, tăng chỉ số .0. thành .1., .2. liên tiếp. Mã hành vi, mức và lỗi không trùng trong từng nhóm.',
    ],
    [
      'Tiêu chí: cold_call dùng opening_hook; warm_call dùng reconnect_agenda. Trọng số cộng thành 100. Mức điểm tăng dần từ 0; cần đủ mọi mã hành vi, chọn mức cao nhất rồi áp trần lỗi thấp nhất. Bộ điểm mẫu chưa hiệu chỉnh.',
    ],
    [
      'Kịch bản AI và thông tin ẩn chỉ dành cho AI. Tên, xưng hô và các mục config.learnerKnows được hiển thị cho người luyện.',
    ],
    HEADERS,
    ...fieldsForDraft(layout).map((field) => [
      field.key.startsWith('offering.')
        ? '02 · Sản phẩm'
        : field.key.startsWith('config.buyer.') ||
            field.key === 'config.learnerKnows'
          ? '03 · Khách hàng'
          : field.key.startsWith('config.')
            ? '04 · Kịch bản AI'
            : field.key.startsWith('scorecard.')
              ? '05 · Đánh giá'
              : '01 · Bài luyện',
      field.key,
      `${field.label}${field.required ? ' *' : ''}`,
      sample[field.key] ?? '',
      [
        field.key === 'config.sinceLastContact'
          ? 'Bắt buộc cho gọi lại.'
          : field.required
            ? 'Bắt buộc nếu sử dụng mục này.'
            : 'Không bắt buộc.',
        field.hint ?? '',
        field.help ?? '',
        field.options
          ? field.options.map(([v, l]) => `${v} = ${l}`).join('; ')
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    ]),
  ]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!merges'] = Array.from({ length: 7 }, (_, r) => ({
    s: { r, c: 0 },
    e: { r, c: 4 },
  }))
  sheet['!autofilter'] = { ref: `A8:E${rows.length}` }
  sheet['!cols'] = [
    { wch: 22 },
    { wch: 48 },
    { wch: 34 },
    { wch: 95 },
    { wch: 100 },
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Bai luyen')
  return workbook
}
export async function downloadPracticeTemplate() {
  const workbook = await createPracticeTemplateWorkbook()
  XLSX.writeFile(workbook, 'salescoach-mau-bai-luyen.xlsx')
}

export async function readPracticeWorkbook(
  data: ArrayBuffer,
): Promise<PracticeDraft> {
  if (data.byteLength > MAX_WORKBOOK_BYTES)
    throw new Error('File vượt quá giới hạn 5 MB.')
  const workbook = XLSX.read(data, {
    type: 'array',
    cellFormula: true,
    sheetRows: 2001,
  })
  if (workbook.SheetNames.length !== 1)
    throw new Error('Vui lòng dùng mẫu Excel có đúng một sheet.')
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  })
  if (rows.length > 2000)
    throw new Error('File có quá nhiều hàng (tối đa 2.000).')
  const headerIndex = rows.findIndex(
    (row) => row[1] === HEADERS[1] && row[3] === HEADERS[3],
  )
  if (headerIndex < 0)
    throw new Error(
      'File không đúng mẫu. Hãy tải mẫu Excel và giữ nguyên hàng tiêu đề.',
    )
  const imported: PracticeDraft = {}
  const seen = new Set<string>()
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const key = String(rows[i][1] ?? '').trim()
    const value = rows[i][3]
    if (!key && (value === '' || value == null)) continue
    if (
      !key ||
      key
        .split('.')
        .some((part) =>
          ['__proto__', 'constructor', 'prototype'].includes(part),
        )
    )
      throw new Error(`Mã trường không hợp lệ ở hàng ${i + 1}.`)
    if (seen.has(key))
      throw new Error(`Mã trường bị trùng ở hàng ${i + 1}: ${key}`)
    seen.add(key)
    const cell = sheet[XLSX.utils.encode_cell({ r: i, c: 3 })]
    if (cell?.f)
      throw new Error(`Hàng ${i + 1}: vui lòng nhập giá trị thay vì công thức.`)
    if (cell?.t === 'e') throw new Error(`Hàng ${i + 1} chứa lỗi Excel.`)
    // Excel turns a typed "2026-10" into a date serial; read it back as YYYY-MM.
    const date =
      key === 'offering.asOf' && typeof value === 'number'
        ? XLSX.SSF.parse_date_code(value)
        : null
    if (date) {
      imported[key] = `${date.y}-${String(date.m).padStart(2, '0')}`
      continue
    }
    if (value !== '' && value != null) imported[key] = String(value).trim()
  }
  if (!Object.keys(imported).length)
    throw new Error('File chưa có nội dung trong cột Giá trị.')
  const type = imported.type === 'warm_call' ? 'warm_call' : 'cold_call'
  const layout = Object.fromEntries(
    [...seen].map((key) => [key, imported[key] ?? '']),
  )
  const allowed = new Set(
    fieldsForDraft({ ...layout, type }).map((field) => field.key),
  )
  for (const key of seen) {
    // Blank repeatable rows are still valid template fields.
    const repeatMatch = Object.entries(repeatFields).some(
      ([prefix, fields]) =>
        key.startsWith(`${prefix}.`) &&
        /^\d+$/.test(key.slice(prefix.length + 1).split('.')[0]) &&
        fields.some(
          (field) =>
            key ===
            `${prefix}.${key.slice(prefix.length + 1).split('.')[0]}.${field.key}`,
        ),
    )
    if (!allowed.has(key) && !repeatMatch)
      throw new Error(`Trường không được hỗ trợ: ${key}`)
  }
  const prefixes = [
    ...Object.keys(repeatFields),
    ...Array.from({ length: 5 }, (_, index) =>
      Object.keys(rubricRepeatFields).map(
        (collection) => `scorecard.${index}.rubric.${collection}`,
      ),
    ).flat(),
  ]
  for (const prefix of prefixes) {
    const indexes = repeatIndexes(imported, prefix)
    if (indexes.some((index, position) => index !== position))
      throw new Error(`Chỉ số trong ${prefix} phải liên tiếp từ 0.`)
  }
  const draft = { ...defaultScorecard(type), ...imported }
  // A supplied rubric is a complete replacement, not a merge with starter rows.
  // This preserves removed behaviors, levels and all critical errors.
  for (let index = 0; index < 5; index++) {
    const prefix = `scorecard.${index}.rubric.`
    if (![...seen].some((key) => key.startsWith(prefix))) continue
    for (const key of Object.keys(draft))
      if (key.startsWith(prefix)) delete draft[key]
    for (const key of seen)
      if (key.startsWith(prefix)) draft[key] = imported[key] ?? ''
  }
  return draft
}
