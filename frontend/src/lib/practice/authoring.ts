import { z } from 'zod'
import {
  agentConfigSchema,
  learnerBriefSchema,
  rubricSchema,
  salesOfferingSchema,
} from './validation'
import { SCORECARD_TEMPLATES, COMPETENCY_CATALOGUE } from './scorecards'

export const customPracticeSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    type: z.enum(['cold_call', 'warm_call']),
    difficulty: z.enum(['beginner', 'intermediate', 'advanced']),
    estimatedMinutes: z.number().int().min(1).max(60),
    learnerInstructions: z.string().optional(),
    tags: z.array(z.string()).default([]),
    learnerBrief: learnerBriefSchema,
    offering: salesOfferingSchema,
    config: agentConfigSchema,
    scorecard: z
      .array(
        z.object({
          competencyCode: z.string(),
          weight: z.number().int().min(1).max(100),
          rubric: rubricSchema,
        }),
      )
      .length(5),
  })
  .superRefine((data, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message })
    if (data.type !== data.config.kind)
      issue(['type'], 'Loại cuộc gọi không khớp kịch bản.')
    if (!data.config.behaviorRules.length)
      issue(['config', 'behaviorRules'], 'Cần có hướng dẫn phản ứng của AI.')
    if (
      data.type === 'warm_call' &&
      !data.learnerBrief.previousInteractions?.length
    )
      issue(
        ['learnerBrief', 'previousInteractions', 0, 'when'],
        'Cuộc gọi lại cần ít nhất một lần trao đổi trước.',
      )
    if (
      data.type === 'cold_call' &&
      data.learnerBrief.previousInteractions?.length
    )
      issue(
        ['learnerBrief', 'previousInteractions'],
        'Cuộc gọi đầu tiên không có lịch sử trao đổi.',
      )
    if (data.scorecard.reduce((sum, item) => sum + item.weight, 0) !== 100)
      issue(['scorecard'], 'Tổng trọng số phải bằng 100%.')
    if (
      new Set(data.scorecard.map((item) => item.competencyCode)).size !==
      data.scorecard.length
    )
      issue(['scorecard'], 'Kỹ năng đánh giá không được trùng lặp.')
    data.scorecard.forEach((item, index) => {
      if (
        !SCORECARD_TEMPLATES[data.type].some(
          (c) => c.competencyCode === item.competencyCode,
        )
      )
        issue(['scorecard', index, 'competencyCode'], 'Kỹ năng không hợp lệ.')
    })
    for (const name of ['hiddenInsights', 'objections'] as const) {
      if (
        new Set(data.config[name].map((item) => item.key)).size !==
        data.config[name].length
      )
        issue(['config', name], 'Mã không được trùng lặp.')
    }
    const knows = data.config.learnerKnows
    if (new Set(knows).size !== knows.length)
      issue(
        ['config', 'learnerKnows'],
        'Thông tin được biết trước không được trùng lặp.',
      )
    knows.forEach((field) => {
      if (
        knows.some((other) => other !== field && field.startsWith(`${other}.`))
      )
        issue(
          ['config', 'learnerKnows'],
          'Không chọn đồng thời nhóm thông tin và mục con.',
        )
      const [parent, child] = field.split('.')
      const value = (data.config.buyer as unknown as Record<string, unknown>)[
        parent
      ]
      if (
        (child
          ? (value as Record<string, unknown> | undefined)?.[child]
          : value) == null
      )
        issue(
          ['config', 'learnerKnows'],
          'Thông tin được biết trước cần có giá trị.',
        )
    })
    data.config.hiddenInsights.forEach((item, index) => {
      if (
        item.relatesTo &&
        knows.some(
          (field) =>
            item.relatesTo === field || item.relatesTo!.startsWith(`${field}.`),
        )
      )
        issue(
          ['config', 'hiddenInsights', index, 'relatesTo'],
          'Thông tin ẩn không thể là thông tin được biết trước.',
        )
    })
    if (
      data.config.buyer.budget.min != null &&
      data.config.buyer.budget.min > data.config.buyer.budget.max
    )
      issue(
        ['config', 'buyer', 'budget', 'min'],
        'Ngân sách tối thiểu vượt ngân sách tối đa.',
      )
  })

export type CustomPracticeInput = z.infer<typeof customPracticeSchema>
export type PracticeDraft = Record<string, string>
export type AuthoringField = {
  key: string
  label: string
  kind?: 'number' | 'lines' | 'text'
  format?: 'vnd'
  options?: readonly (readonly [string, string])[]
  required?: boolean
  wide?: boolean
  hint?: string
  help?: string
}
export const callOptions = [
  ['cold_call', 'Gọi lần đầu'],
  ['warm_call', 'Gọi lại'],
] as const
export const difficultyOptions = [
  ['beginner', 'Cơ bản'],
  ['intermediate', 'Trung cấp'],
  ['advanced', 'Nâng cao'],
] as const
export const motivationOptions = [
  ['own_use', 'Mua để ở'],
  ['investment', 'Đầu tư'],
  ['mixed', 'Ở và đầu tư'],
] as const
const f = (
  key: string,
  label: string,
  extras: Partial<AuthoringField> = {},
): AuthoringField => ({ key, label, ...extras })
const required = { required: true }
const long = { wide: true, kind: 'text' as const }
const lines = {
  wide: true,
  kind: 'lines' as const,
  hint: 'Mỗi dòng là một mục.',
}
const num = { kind: 'number' as const }
const vnd = { ...num, format: 'vnd' as const }
export const informationFields = [
  f('title', 'Tên bài luyện', { ...required, wide: true }),
  f('type', 'Loại cuộc gọi', {
    ...required,
    options: callOptions,
    help: 'Chọn “Gọi lần đầu” nếu chưa từng trao đổi với khách. “Gọi lại” cần có lịch sử liên hệ và tình huống thay đổi từ lần trước.',
  }),
  f('difficulty', 'Độ khó', {
    ...required,
    options: difficultyOptions,
    help: 'Chọn mức phù hợp với người luyện. Để tình huống khó hơn, bổ sung phản đối, thái độ dè dặt hoặc nhu cầu cần khai thác.',
  }),
  f('estimatedMinutes', 'Thời lượng dự kiến (phút)', { ...num, ...required }),
  f('description', 'Mô tả ngắn', long),
  f('learnerBrief.background', 'Bối cảnh trước cuộc gọi', {
    ...long,
    ...required,
    help: 'Viết những gì người luyện đã biết trước khi gọi, như nguồn khách và lý do liên hệ. Giữ các thông tin cần khám phá trong kịch bản riêng của AI.',
  }),
  f('learnerBrief.objective', 'Mục tiêu cuộc gọi', {
    ...long,
    ...required,
    help: 'Chọn một kết quả cụ thể có thể quan sát được. Ví dụ: hẹn khách xem nhà vào sáng thứ Bảy, thay vì “tư vấn tốt”.',
  }),
  f('learnerBrief.leadSource', 'Nguồn khách hàng', { wide: true }),
  f('learnerInstructions', 'Hướng dẫn cho người luyện', {
    ...long,
    help: 'Nêu cách chuẩn bị hoặc yêu cầu khi luyện, ví dụ: xác nhận nhu cầu trước khi giới thiệu sản phẩm. Nội dung này dành cho người luyện.',
  }),
  f('tags', 'Nhãn phân loại', lines),
]
export const offeringFields = [
  f('offering.projectName', 'Tên dự án', required),
  f('offering.productType', 'Loại sản phẩm', {
    ...required,
    options: [
      ['apartment', 'Căn hộ'],
      ['townhouse', 'Nhà phố'],
      ['villa', 'Biệt thự'],
      ['shophouse', 'Shophouse'],
      ['land', 'Đất nền'],
      ['other', 'Khác'],
    ],
  }),
  f('offering.developer', 'Chủ đầu tư'),
  f('offering.location.district', 'Quận / Huyện', required),
  f('offering.location.city', 'Tỉnh / Thành phố', required),
  f('offering.location.address', 'Địa chỉ'),
  f('offering.unit.bedrooms', 'Số phòng ngủ', num),
  f('offering.unit.bathrooms', 'Số phòng tắm', num),
  f('offering.unit.areaM2', 'Diện tích (m²)', { ...num, ...required }),
  f('offering.price.amount', 'Giá bán (VND)', {
    ...vnd,
    ...required,
    help: 'Nhập tổng giá bán bằng VND; dấu phân cách được thêm tự động. Ví dụ: 2.500.000.000 là 2,5 tỷ đồng. Dùng ghi chú giá để nêu thuế, phí hoặc điều kiện áp dụng.',
  }),
  f('offering.price.pricePerM2', 'Giá mỗi m² (VND)', vnd),
  f('offering.unit.floor', 'Tầng'),
  f('offering.unit.view', 'Hướng nhìn'),
  f('offering.unit.furnishing', 'Nội thất'),
  f('offering.price.note', 'Ghi chú giá', long),
  f('offering.location.highlights', 'Tiện ích vị trí', lines),
  f('offering.paymentPlan.summary', 'Phương thức thanh toán', {
    ...long,
    ...required,
    help: 'Tóm tắt các đợt và điều kiện thanh toán để AI có dữ kiện khi khách hỏi. Ví dụ: đặt cọc 50 triệu, thanh toán 30% khi ký hợp đồng.',
  }),
  f('offering.paymentPlan.loanSupport', 'Hỗ trợ vay', long),
  f('offering.paymentPlan.promotions', 'Ưu đãi', lines),
  f('offering.handover', 'Thời gian bàn giao'),
  f('offering.legalStatus', 'Pháp lý'),
  f('offering.asOf', 'Thông tin cập nhật tại tháng', {
    hint: 'Định dạng YYYY-MM, ví dụ 2026-10.',
    help: 'Cuộc gọi được coi là diễn ra trong tháng này. Khách hàng AI và phần chấm điểm hiểu giá, ưu đãi và thời gian bàn giao theo thời điểm này, kể cả khi dự án thực tế đã thay đổi.',
  }),
  f('offering.keyStrengths', 'Điểm mạnh', {
    ...lines,
    ...required,
    help: 'Nêu lợi ích cụ thể có thể gắn với nhu cầu khách, ví dụ: gần trường học hoặc có lịch thanh toán linh hoạt.',
  }),
  f('offering.keyWeaknesses', 'Điểm hạn chế', {
    ...lines,
    ...required,
    help: 'Nêu hạn chế thực tế để cuộc gọi có thử thách, ví dụ: xa trung tâm hoặc chưa có nội thất. Người luyện cần giải thích và xử lý phù hợp.',
  }),
]
export const buyerFields = [
  f('config.buyer.name', 'Tên khách hàng', required),
  f('config.buyer.addressTerm', 'Xưng hô', {
    ...required,
    options: ['anh', 'chị', 'cô', 'chú', 'bác', 'em'].map((v) => [v, v]),
  }),
  f('config.buyer.gender', 'Giới tính', {
    ...required,
    options: [
      ['male', 'Nam'],
      ['female', 'Nữ'],
    ],
  }),
  f('config.buyer.age', 'Tuổi', { ...num, ...required }),
  f('config.buyer.occupation', 'Nghề nghiệp'),
  f('config.buyer.familySituation', 'Gia đình'),
  f('config.buyer.motivation.type', 'Mục đích mua', {
    ...required,
    options: motivationOptions,
  }),
  f('config.buyer.budget.max', 'Ngân sách tối đa (VND)', {
    ...vnd,
    ...required,
    help: 'Nhập mức tiền tối đa khách có thể chi bằng VND, ví dụ: 3.000.000.000 cho 3 tỷ đồng. Dấu phân cách được thêm tự động. Ngân sách có thể khác giá sản phẩm.',
  }),
  f('config.buyer.budget.min', 'Ngân sách tối thiểu (VND)', vnd),
  f('config.buyer.budget.fundingSource', 'Nguồn vốn'),
  f('config.buyer.budget.detail', 'Chi tiết tài chính', {
    ...long,
    help: 'Mô tả tiền sẵn có, khoản vay dự kiến và lo ngại tài chính. Ví dụ: có 1,5 tỷ tiền mặt, cần vay phần còn lại nhưng lo lãi suất.',
  }),
  f('config.buyer.priorities', 'Nhu cầu & ưu tiên', {
    ...lines,
    ...required,
    help: 'Nêu các yếu tố khách coi trọng theo thứ tự ưu tiên. Ví dụ: gần trường của con, có 2 phòng ngủ, rồi mới đến hướng nhìn.',
  }),
  f('config.buyer.decisionMaker.role', 'Người quyết định', {
    ...required,
    options: [
      ['sole_decision_maker', 'Tự quyết định'],
      ['joint_with_spouse', 'Cùng vợ / chồng'],
      ['family_decision', 'Gia đình'],
      ['influencer', 'Người ảnh hưởng'],
    ],
  }),
  f('config.buyer.decisionMaker.detail', 'Chi tiết người quyết định', {
    help: 'Nêu ai cần đồng ý và khách có thể quyết định đến đâu. Ví dụ: khách chọn căn nhưng cần vợ/chồng duyệt ngân sách trước khi đặt cọc.',
  }),
  f('config.buyer.emotionalState', 'Thái độ ban đầu', {
    ...required,
    options: [
      ['friendly', 'Thân thiện'],
      ['neutral', 'Trung lập'],
      ['guarded', 'Dè dặt'],
      ['impatient', 'Thiếu kiên nhẫn'],
      ['hostile', 'Khó chịu'],
    ],
  }),
  f('config.buyer.urgency.level', 'Mức độ cần mua', {
    ...required,
    options: [
      ['low', 'Chưa gấp'],
      ['medium', 'Vừa phải'],
      ['high', 'Gấp'],
    ],
  }),
  f('config.buyer.motivation.detail', 'Lý do mua', { ...long, ...required }),
  f('config.buyer.urgency.timeline', 'Thời điểm muốn mua'),
  f('config.buyer.urgency.driver', 'Lý do cần mua sớm'),
  f('config.buyer.communicationStyle', 'Phong cách giao tiếp', {
    ...lines,
    help: 'Mô tả cách khách nói chuyện để AI đóng vai nhất quán. Ví dụ: trả lời ngắn, muốn nghe số liệu và không thích bị thúc ép.',
  }),
]
export const scenarioFields = [
  f('config.privateBackground', 'Tình huống riêng của khách', {
    ...long,
    ...required,
    help: 'Mô tả hoàn cảnh thật mà chỉ AI biết, ví dụ: khách cần chuyển nhà vì hợp đồng thuê sắp hết. Người luyện sẽ phải khai thác trong cuộc gọi.',
  }),
  f('config.recollection', 'Khách nhớ gì về bạn?', {
    ...long,
    ...required,
    help: 'Ghi điều khách nhớ về người gọi hoặc lần trao đổi trước. Với cuộc gọi lần đầu, có thể ghi “Chưa biết người gọi, chưa từng trao đổi”.',
  }),
  f('config.sinceLastContact', 'Thay đổi từ lần liên hệ trước', {
    ...long,
    ...required,
    help: 'Nêu điều mới xảy ra để cuộc gọi lại có lý do, ví dụ: khách đã xem dự án khác hoặc gia đình thay đổi ngân sách.',
  }),
  f('config.behaviorRules', 'Hướng dẫn phản ứng của AI', {
    ...lines,
    ...required,
    help: 'Viết phản ứng theo tình huống, ví dụ: nếu người luyện hỏi mở về nhu cầu, chia sẻ thêm; nếu thúc ép đặt cọc, trở nên dè dặt.',
  }),
  f('config.successCriteria', 'Điều kiện đạt mục tiêu', {
    ...lines,
    ...required,
    help: 'Nêu dấu hiệu cụ thể để xác định cuộc gọi đạt mục tiêu, ví dụ: khách đồng ý lịch xem nhà và xác nhận ngày, giờ. Giữ nhất quán với mục tiêu cuộc gọi.',
  }),
]
export const voiceFields = [
  f('config.buyer.voice.voiceId', 'Mã giọng nói', {
    help: 'Chỉ điền khi bạn đã có mã giọng nói được hệ thống hỗ trợ. Nếu chưa biết mã, để trống để dùng giọng mặc định.',
  }),
  f('config.buyer.voice.speakingStyle', 'Phong cách giọng nói'),
  f('config.buyer.voice.pace', 'Tốc độ nói', {
    options: [
      ['slow', 'Chậm'],
      ['normal', 'Bình thường'],
      ['fast', 'Nhanh'],
    ],
  }),
  f('config.openingLine', 'Câu mở đầu của khách', {
    ...long,
    help: 'Viết câu khách nói khi bắt máy, theo đúng thái độ và xưng hô. Ví dụ: “A lô, ai đấy? Anh đang hơi bận.”',
  }),
  f('config.hangUpGuidance', 'Điều kiện kết thúc cuộc gọi', {
    ...long,
    help: 'Nêu khi nào khách nên dừng cuộc gọi, ví dụ: người luyện tiếp tục thúc ép sau khi khách đã từ chối, hoặc hai bên đã xác nhận bước tiếp theo.',
  }),
]
export const disclosureOptions = [
  ['age', 'Tuổi'],
  ['occupation', 'Nghề nghiệp'],
  ['familySituation', 'Gia đình'],
  ['motivation', 'Mục đích mua'],
  ['budget', 'Ngân sách'],
  ['priorities', 'Ưu tiên'],
  ['decisionMaker', 'Người quyết định'],
  ['urgency', 'Mức độ cần mua'],
  ['emotionalState', 'Thái độ'],
] as const
export const repeatFields = {
  'learnerBrief.previousInteractions': [
    f('when', 'Thời điểm', required),
    f('channel', 'Kênh liên hệ', {
      ...required,
      options: [
        ['phone', 'Điện thoại'],
        ['zalo', 'Zalo'],
        ['showroom', 'Nhà mẫu'],
        ['site_visit', 'Xem nhà'],
        ['event', 'Sự kiện'],
      ],
    }),
    f('summary', 'Nội dung đã trao đổi', {
      ...long,
      ...required,
      help: 'Tóm tắt điều khách và người luyện đã nói hoặc đã thống nhất. Ví dụ: đã gửi bảng giá căn 2 phòng ngủ, khách muốn hỏi thêm về vay ngân hàng.',
    }),
    f('agreedNextStep', 'Bước tiếp theo đã hẹn', long),
  ],
  'config.hiddenInsights': [
    f('key', 'Mã thông tin', {
      ...required,
      help: 'Mã dùng để phân biệt các thông tin ẩn, ví dụ: insight_1 hoặc lease_ends. Có thể giữ mã tự điền; mỗi thông tin cần một mã riêng.',
    }),
    f('insight', 'Thông tin ẩn', {
      ...long,
      ...required,
      help: 'Viết một sự thật người luyện cần khám phá, ví dụ: khách muốn chuyển nhà trước khi con vào năm học mới. Đừng đưa thông tin này vào bối cảnh công khai.',
    }),
    f('revealGuidance', 'Khi nào khách chia sẻ?', {
      ...long,
      help: 'Nêu cách hỏi hoặc hành vi khiến khách tiết lộ, ví dụ: chỉ chia sẻ khi người luyện hỏi lý do cần chuyển nhà và lắng nghe câu trả lời.',
    }),
    f('relatesTo', 'Liên quan đến', {
      options: disclosureOptions,
      help: 'Chọn nhóm thông tin mà bí mật này bổ sung. Nếu chọn một nhóm, không đánh dấu nhóm đó là thông tin người luyện được biết trước.',
    }),
  ],
  'config.objections': [
    f('key', 'Mã phản đối', {
      ...required,
      help: 'Mã dùng để phân biệt các phản đối, ví dụ: objection_1 hoặc price_concern. Có thể giữ mã tự điền; mỗi phản đối cần một mã riêng.',
    }),
    f('category', 'Loại phản đối', {
      ...required,
      options: [
        ['brush_off', 'Đang bận'],
        ['not_interested', 'Không quan tâm'],
        ['timing', 'Thời điểm'],
        ['price', 'Giá'],
        ['trust', 'Niềm tin'],
        ['product', 'Sản phẩm'],
        ['decision_authority', 'Người quyết định'],
        ['competitor', 'Đối thủ'],
      ],
    }),
    f('sampleWording', 'Khách có thể nói', { ...long, ...required }),
    f('underlyingReason', 'Lý do thực sự', {
      ...long,
      help: 'Nêu nguyên nhân phía sau lời từ chối. Ví dụ: khách nói “giá cao” nhưng thực ra lo khoản trả góp vượt thu nhập hàng tháng.',
    }),
    f('raiseGuidance', 'Khi nào khách phản đối?', {
      ...long,
      ...required,
      help: 'Nêu tình huống kích hoạt phản đối, ví dụ: khi người luyện đề nghị đặt cọc trước khi làm rõ phương án vay.',
    }),
    f('resolutionGuidance', 'Cách xử lý khiến khách cởi mở', {
      ...long,
      ...required,
      help: 'Nêu cách xử lý đủ thuyết phục để khách bớt lo, ví dụ: giải thích khoản trả hàng tháng và xác nhận mức chi trả phù hợp trước khi đề xuất bước tiếp theo.',
    }),
  ],
  'offering.paymentPlan.milestones': [
    f('label', 'Đợt thanh toán', required),
    f('percent', 'Tỷ lệ (%)', { ...num, ...required }),
    f('timing', 'Thời điểm thanh toán', required),
  ],
  'offering.competitors': [
    f('name', 'Tên đối thủ', required),
    f('comparison', 'So sánh', { ...long, ...required }),
  ],
} satisfies Record<string, AuthoringField[]>
export type RepeatKey = keyof typeof repeatFields
export function repeatIndexes(draft: PracticeDraft, prefix: string) {
  return [
    ...new Set(
      Object.keys(draft)
        .filter((key) => key.startsWith(`${prefix}.`))
        .map((key) => key.slice(prefix.length + 1).split('.')[0])
        .filter((index) => /^(0|[1-9]\d*)$/.test(index))
        .map(Number),
    ),
  ].sort((a, b) => a - b)
}
export const rubricRepeatFields = {
  behaviors: [
    f('id', 'Mã hành vi', {
      ...required,
      help: 'Mã ổn định, không trùng trong kỹ năng. Dùng mã này trong điều kiện của các mức điểm.',
    }),
    f('description', 'Hành vi quan sát được', {
      ...long,
      ...required,
      help: 'Mô tả rõ điều kiện đạt hành vi. Chỉ hành vi được chứng minh đạt yêu cầu mới thỏa mức điểm; nỗ lực chưa đạt được ghi nhận để cải thiện, không thỏa điều kiện.',
    }),
  ],
  levels: [
    f('id', 'Mã mức điểm', required),
    f('label', 'Tên mức điểm', required),
    f('score', 'Điểm cố định (0–100)', {
      ...num,
      ...required,
      help: 'Các mức tăng dần, không trùng điểm. Mức đầu tiên là 0; không nội suy giữa các mức.',
    }),
    f('requiredBehaviorIds', 'Mã hành vi bắt buộc', {
      ...lines,
      help: 'Mỗi dòng một mã hành vi. Số mã là số hành vi cần đạt để lên mức này, theo bất kỳ thứ tự nào. Mức 0 để trống; các mức khác cần ít nhất một mã.',
    }),
  ],
  criticalErrors: [
    f('id', 'Mã lỗi nghiêm trọng', required),
    f('description', 'Hành vi lỗi nghiêm trọng', { ...long, ...required }),
    f('scoreCap', 'Trần điểm khi có lỗi (0–100)', {
      ...num,
      ...required,
      help: 'Lỗi này giới hạn điểm kỹ năng. Nếu có nhiều lỗi, dùng trần thấp nhất; lỗi không cộng hoặc trừ điểm độc lập.',
    }),
  ],
} satisfies Record<string, AuthoringField[]>
export type RubricRepeatKey = keyof typeof rubricRepeatFields
export function scorecardFields(
  type: CustomPracticeInput['type'],
  draft: PracticeDraft,
): AuthoringField[] {
  return SCORECARD_TEMPLATES[type].flatMap((criterion, i) => [
    f(`scorecard.${i}.competencyCode`, 'Mã kỹ năng', required),
    f(
      `scorecard.${i}.weight`,
      COMPETENCY_CATALOGUE.find((c) => c.code === criterion.competencyCode)!
        .name,
      { ...num, ...required },
    ),
    f(`scorecard.${i}.rubric.description`, 'Hướng dẫn chấm', {
      ...long,
      ...required,
      help: 'Chấm theo số hành vi được chứng minh, không phân biệt thứ tự, rồi áp trần lỗi nghiêm trọng. Bộ điểm và trần có sẵn chỉ là chính sách khởi đầu, chưa hiệu chỉnh.',
    }),
    ...Object.entries(rubricRepeatFields).flatMap(([collection, fields]) => {
      const prefix = `scorecard.${i}.rubric.${collection}`
      return repeatIndexes(draft, prefix).flatMap((index) =>
        fields.map((field) => ({
          ...field,
          key: `${prefix}.${index}.${field.key}`,
        })),
      )
    }),
  ])
}
export function fieldsForDraft(draft: PracticeDraft): AuthoringField[] {
  return [
    ...informationFields,
    ...offeringFields,
    ...buyerFields,
    ...scenarioFields,
    ...voiceFields,
    f('config.learnerKnows', 'Người luyện được biết trước', {
      ...lines,
      hint: `Mỗi dòng một mã: ${disclosureOptions.map(([code, label]) => `${code} = ${label}`).join('; ')}. Tên và xưng hô luôn hiển thị.`,
    }),
    ...Object.entries(repeatFields).flatMap(([prefix, fields]) =>
      repeatIndexes(draft, prefix).flatMap((i) =>
        fields.map((field) => ({
          ...field,
          key: `${prefix}.${i}.${field.key}`,
        })),
      ),
    ),
    ...scorecardFields(
      draft.type === 'warm_call' ? 'warm_call' : 'cold_call',
      draft,
    ),
  ]
}
export function flattenValues(
  value: unknown,
  prefix = '',
  result: PracticeDraft = {},
): PracticeDraft {
  if (value == null) return result
  if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    result[prefix] = value.join('\n')
  else if (typeof value === 'object')
    Object.entries(value).forEach(([key, child]) =>
      flattenValues(child, prefix ? `${prefix}.${key}` : key, result),
    )
  else result[prefix] = String(value)
  return result
}
export function defaultScorecard(type: CustomPracticeInput['type']) {
  return flattenValues(
    SCORECARD_TEMPLATES[type].map((c) => ({
      competencyCode: c.competencyCode,
      weight: c.weight,
      rubric: c.defaultRubric,
    })),
    'scorecard',
  )
}
export function emptyDraft(): PracticeDraft {
  return {
    type: 'cold_call',
    difficulty: 'beginner',
    estimatedMinutes: '5',
    'offering.productType': 'apartment',
    'config.buyer.addressTerm': 'anh',
    'config.buyer.gender': 'male',
    'config.buyer.motivation.type': 'own_use',
    'config.buyer.decisionMaker.role': 'sole_decision_maker',
    'config.buyer.emotionalState': 'neutral',
    'config.buyer.urgency.level': 'medium',
    ...defaultScorecard('cold_call'),
  }
}
function setPath(root: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let target: Record<string, unknown> = root
  parts.forEach((part, i) => {
    if (i === parts.length - 1) target[part] = value
    else
      target = (target[part] ??= /^\d+$/.test(parts[i + 1])
        ? []
        : {}) as Record<string, unknown>
  })
}
export function draftPayload(draft: PracticeDraft): unknown {
  const root: Record<string, unknown> = {}
  SCORECARD_TEMPLATES[
    draft.type === 'warm_call' ? 'warm_call' : 'cold_call'
  ].forEach((_, index) => {
    for (const collection of Object.keys(rubricRepeatFields))
      setPath(root, `scorecard.${index}.rubric.${collection}`, [])
  })
  fieldsForDraft(draft).forEach((field) => {
    if (
      draft.type === 'cold_call' &&
      (field.key.startsWith('learnerBrief.previousInteractions.') ||
        field.key === 'config.sinceLastContact')
    )
      return
    const value = draft[field.key] ? draft[field.key].trim() : ''
    if (
      !value &&
      !(field.kind === 'lines' && field.key.endsWith('.requiredBehaviorIds'))
    )
      return
    setPath(
      root,
      field.key,
      field.kind === 'number'
        ? Number(value)
        : field.kind === 'lines'
          ? value
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean)
          : value,
    )
  })
  setPath(root, 'config.kind', draft.type)
  setPath(root, 'offering.price.currency', 'VND')
  setPath(root, 'config.buyer.budget.currency', 'VND')
  setPath(
    root,
    'config.behaviorRules',
    (draft['config.behaviorRules'] ?? '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  )
  return root
}
export function validateDraft(draft: PracticeDraft) {
  const result = customPracticeSchema.safeParse(draftPayload(draft))
  const errors: Record<string, string> = {}
  if (!result.success)
    result.error.issues.forEach((issue) => {
      errors[issue.path.join('.')] =
        issue.code === 'custom'
          ? issue.message
          : 'Vui lòng nhập giá trị hợp lệ.'
    })
  if (
    draft.type === 'warm_call' &&
    !repeatIndexes(draft, 'learnerBrief.previousInteractions').length
  )
    errors['learnerBrief.previousInteractions.0.when'] =
      'Cuộc gọi lại cần ít nhất một lần trao đổi trước.'
  return { result, errors }
}
