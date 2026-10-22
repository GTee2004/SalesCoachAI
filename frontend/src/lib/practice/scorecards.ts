import type { CompetencyRubric, PracticeType } from '#/db/schema'

export type ScorecardCriterion = {
  competencyCode: string
  weight: number
  defaultRubric: CompetencyRubric
}

// Starter policy, not calibrated: the level matching how many behaviors were
// demonstrated (in any order), then the lowest triggered critical-error cap.
// Repeating a behavior never adds points.
const sharedCriticalErrors: CompetencyRubric['criticalErrors'] = [
  {
    id: 'false_product_facts',
    description:
      'Nói sai giá, phương thức thanh toán hoặc pháp lý của sản phẩm.',
    scoreCap: 40,
  },
  {
    id: 'fabricated_promise',
    description:
      'Bịa khuyến mãi, cam kết hoặc lợi nhuận không có trong thông tin sản phẩm.',
    scoreCap: 0,
  },
  {
    id: 'pressure_after_refusal',
    description: 'Tiếp tục chào hàng sau khi khách đã từ chối rõ ràng hai lần.',
    scoreCap: 40,
  },
  {
    id: 'disrespect',
    description: 'Dùng lời lẽ thiếu tôn trọng.',
    scoreCap: 0,
  },
]

const discovery = (
  focus: [
    CompetencyRubric['behaviors'][number],
    CompetencyRubric['behaviors'][number],
  ],
): CompetencyRubric => ({
  description:
    'Tìm hiểu động cơ, ngân sách, người ra quyết định và mức độ gấp của khách bằng câu hỏi mở.',
  behaviors: [
    ...focus,
    {
      id: 'follow_up',
      description:
        'Hỏi tiếp dựa trên câu trả lời cụ thể của khách thay vì hỏi theo danh sách.',
    },
    {
      id: 'confirm_priority',
      description:
        'Tóm tắt nhu cầu hoặc ưu tiên khách đã chia sẻ và hỏi xác nhận lại.',
    },
  ],
  levels: [
    {
      id: 'none',
      label: 'Chưa thể hiện hành vi khám phá',
      score: 0,
      requiredBehaviorIds: [],
    },
    {
      id: 'initial_need',
      label: 'Khám phá nhu cầu ban đầu',
      score: 40,
      requiredBehaviorIds: [focus[0].id],
    },
    {
      id: 'decision_context',
      label: 'Làm rõ thêm bối cảnh quyết định',
      score: 70,
      requiredBehaviorIds: [focus[0].id, focus[1].id],
    },
    {
      id: 'responsive_discovery',
      label: 'Đào sâu theo câu trả lời',
      score: 90,
      requiredBehaviorIds: [focus[0].id, focus[1].id, 'follow_up'],
    },
    {
      id: 'confirmed_discovery',
      label: 'Đào sâu và xác nhận ưu tiên',
      score: 100,
      requiredBehaviorIds: [
        focus[0].id,
        focus[1].id,
        'follow_up',
        'confirm_priority',
      ],
    },
  ],
  criticalErrors: sharedCriticalErrors,
})

const valuePositioning: CompetencyRubric = {
  description:
    'Trình bày 1–2 điểm mạnh của sản phẩm gắn với ưu tiên khách vừa chia sẻ.',
  behaviors: [
    {
      id: 'match_priority',
      description:
        'Chọn điểm mạnh phù hợp với động cơ hoặc ưu tiên khách vừa chia sẻ.',
    },
    {
      id: 'accurate_fact',
      description: 'Nêu số liệu hoặc thông tin sản phẩm chính xác, ngắn gọn.',
    },
    {
      id: 'explain_benefit',
      description:
        'Giải thích cụ thể điểm mạnh giúp giải quyết nhu cầu của khách như thế nào.',
    },
    {
      id: 'check_relevance',
      description:
        'Hỏi khách lợi ích vừa trình bày có phù hợp với ưu tiên của họ không.',
    },
  ],
  levels: [
    {
      id: 'none',
      label: 'Chưa gắn giá trị với khách',
      score: 0,
      requiredBehaviorIds: [],
    },
    {
      id: 'relevant_feature',
      label: 'Chọn điểm mạnh phù hợp',
      score: 40,
      requiredBehaviorIds: ['match_priority'],
    },
    {
      id: 'grounded_value',
      label: 'Điểm mạnh có thông tin chính xác',
      score: 70,
      requiredBehaviorIds: ['match_priority', 'accurate_fact'],
    },
    {
      id: 'explained_value',
      label: 'Giải thích lợi ích cụ thể',
      score: 90,
      requiredBehaviorIds: [
        'match_priority',
        'accurate_fact',
        'explain_benefit',
      ],
    },
    {
      id: 'checked_value',
      label: 'Giải thích và kiểm tra mức phù hợp',
      score: 100,
      requiredBehaviorIds: [
        'match_priority',
        'accurate_fact',
        'explain_benefit',
        'check_relevance',
      ],
    },
  ],
  criticalErrors: sharedCriticalErrors,
}

const objectionHandling = (response: string): CompetencyRubric => ({
  description:
    'Ghi nhận, làm rõ mối lo thực sự, phản hồi cụ thể và kiểm tra khách đã yên tâm chưa.',
  behaviors: [
    {
      id: 'acknowledge',
      description:
        'Ghi nhận phản đối trước khi trả lời, không tranh luận với khách.',
    },
    {
      id: 'clarify_concern',
      description:
        'Hỏi để hiểu nguyên nhân thật đằng sau phản đối trước khi đưa giải pháp.',
    },
    { id: 'specific_response', description: response },
    {
      id: 'check_resolution',
      description: 'Kiểm tra lại khách còn băn khoăn gì sau khi đã phản hồi.',
    },
  ],
  levels: [
    {
      id: 'none',
      label: 'Chưa xử lý phản đối',
      score: 0,
      requiredBehaviorIds: [],
    },
    {
      id: 'acknowledged',
      label: 'Ghi nhận phản đối',
      score: 40,
      requiredBehaviorIds: ['acknowledge'],
    },
    {
      id: 'clarified',
      label: 'Ghi nhận và làm rõ mối lo',
      score: 70,
      requiredBehaviorIds: ['acknowledge', 'clarify_concern'],
    },
    {
      id: 'responded',
      label: 'Phản hồi cụ thể theo mối lo',
      score: 90,
      requiredBehaviorIds: [
        'acknowledge',
        'clarify_concern',
        'specific_response',
      ],
    },
    {
      id: 'checked',
      label: 'Phản hồi và kiểm tra lại',
      score: 100,
      requiredBehaviorIds: [
        'acknowledge',
        'clarify_concern',
        'specific_response',
        'check_resolution',
      ],
    },
  ],
  criticalErrors: sharedCriticalErrors,
})

const nextStep = (example: string): CompetencyRubric => ({
  description:
    'Đề xuất và chốt một bước tiếp theo cụ thể, phù hợp với tình huống của khách.',
  behaviors: [
    {
      id: 'concrete_action',
      description: `Đề xuất hành động cụ thể phù hợp tình huống (${example}).`,
    },
    {
      id: 'confirm_time',
      description:
        'Đề xuất và xác nhận ngày giờ cụ thể cho hành động tiếp theo.',
    },
    {
      id: 'confirm_logistics',
      description:
        'Xác nhận người tham gia và kênh liên lạc hoặc địa điểm cho bước tiếp theo.',
    },
    {
      id: 'recap_agreement',
      description:
        'Tóm tắt lại hành động, thời gian và điều đã thống nhất trước khi kết thúc.',
    },
  ],
  levels: [
    {
      id: 'none',
      label: 'Chưa có bước tiếp theo cụ thể',
      score: 0,
      requiredBehaviorIds: [],
    },
    {
      id: 'action_proposed',
      label: 'Đề xuất hành động cụ thể',
      score: 40,
      requiredBehaviorIds: ['concrete_action'],
    },
    {
      id: 'time_confirmed',
      label: 'Xác nhận thời gian',
      score: 70,
      requiredBehaviorIds: ['concrete_action', 'confirm_time'],
    },
    {
      id: 'logistics_confirmed',
      label: 'Xác nhận người tham gia và liên lạc',
      score: 90,
      requiredBehaviorIds: [
        'concrete_action',
        'confirm_time',
        'confirm_logistics',
      ],
    },
    {
      id: 'agreement_recapped',
      label: 'Chốt rõ và tóm tắt thỏa thuận',
      score: 100,
      requiredBehaviorIds: [
        'concrete_action',
        'confirm_time',
        'confirm_logistics',
        'recap_agreement',
      ],
    },
  ],
  criticalErrors: sharedCriticalErrors,
})

export const SCORECARD_TEMPLATES: Record<PracticeType, ScorecardCriterion[]> = {
  cold_call: [
    {
      competencyCode: 'opening_hook',
      weight: 20,
      defaultRubric: {
        description:
          'Giới thiệu bản thân, công ty và lý do gọi liên quan đến khách; xin phép tiếp tục.',
        behaviors: [
          {
            id: 'identify_self',
            description: 'Giới thiệu rõ tên và công ty trong câu mở đầu.',
          },
          {
            id: 'relevant_source',
            description:
              'Nêu lý do gọi gắn với nguồn khách (form đăng ký, sự kiện…).',
          },
          {
            id: 'ask_permission',
            description:
              'Hỏi khách có tiện nói chuyện hoặc xin phép tiếp tục trước khi trình bày.',
          },
          {
            id: 'set_brief_scope',
            description:
              'Nêu ngắn gọn nội dung và khoảng thời gian dự kiến của cuộc trao đổi.',
          },
        ],
        levels: [
          {
            id: 'none',
            label: 'Chưa có mở đầu rõ ràng',
            score: 0,
            requiredBehaviorIds: [],
          },
          {
            id: 'identified',
            label: 'Giới thiệu rõ danh tính',
            score: 40,
            requiredBehaviorIds: ['identify_self'],
          },
          {
            id: 'relevant_opening',
            label: 'Danh tính và lý do liên quan',
            score: 70,
            requiredBehaviorIds: ['identify_self', 'relevant_source'],
          },
          {
            id: 'permission_opening',
            label: 'Mở đầu liên quan và xin phép',
            score: 90,
            requiredBehaviorIds: [
              'identify_self',
              'relevant_source',
              'ask_permission',
            ],
          },
          {
            id: 'scoped_opening',
            label: 'Mở đầu rõ, xin phép và giới hạn nội dung',
            score: 100,
            requiredBehaviorIds: [
              'identify_self',
              'relevant_source',
              'ask_permission',
              'set_brief_scope',
            ],
          },
        ],
        criticalErrors: [
          {
            id: 'missing_identity',
            description:
              'Không giới thiệu bản thân hoặc công ty khi mở đầu cuộc gọi.',
            scoreCap: 40,
          },
          ...sharedCriticalErrors,
        ],
      },
    },
    {
      competencyCode: 'needs_discovery',
      weight: 25,
      defaultRubric: discovery([
        {
          id: 'purchase_purpose',
          description: 'Khám phá khách mua để ở hay đầu tư bằng câu hỏi mở.',
        },
        {
          id: 'budget_funding',
          description: 'Tìm hiểu ngân sách và nguồn tiền của khách.',
        },
      ]),
    },
    {
      competencyCode: 'value_articulation',
      weight: 15,
      defaultRubric: valuePositioning,
    },
    {
      competencyCode: 'objection_handling',
      weight: 20,
      defaultRubric: objectionHandling(
        'Phản hồi cụ thể theo lý do khách từ chối (ví dụ đang bận) và đưa lựa chọn phù hợp, không ép khách.',
      ),
    },
    {
      competencyCode: 'next_step_closing',
      weight: 20,
      defaultRubric: nextStep('ví dụ: hẹn xem nhà mẫu thứ Bảy 9h'),
    },
  ],
  warm_call: [
    {
      competencyCode: 'reconnect_agenda',
      weight: 10,
      defaultRubric: {
        description:
          'Nhắc lại chính xác lần trao đổi trước, hỏi khách có tiện không và nêu mục đích cuộc gọi.',
        behaviors: [
          {
            id: 'recall_previous',
            description:
              'Nhắc lại đúng nội dung và bước tiếp theo đã hẹn trong lần trao đổi trước.',
          },
          {
            id: 'ask_permission',
            description: 'Hỏi khách có tiện nói chuyện hoặc xin phép tiếp tục.',
          },
          {
            id: 'state_agenda',
            description:
              'Nêu rõ mục đích cuộc gọi hôm nay gắn với lần trao đổi trước.',
          },
          {
            id: 'confirm_agenda',
            description:
              'Hỏi khách xác nhận hoặc bổ sung ưu tiên cho nội dung cuộc trao đổi hôm nay.',
          },
        ],
        levels: [
          {
            id: 'none',
            label: 'Chưa kết nối với lần trước',
            score: 0,
            requiredBehaviorIds: [],
          },
          {
            id: 'recalled',
            label: 'Nhắc đúng lần trao đổi trước',
            score: 40,
            requiredBehaviorIds: ['recall_previous'],
          },
          {
            id: 'permission',
            label: 'Nhắc lần trước và xin phép',
            score: 70,
            requiredBehaviorIds: ['recall_previous', 'ask_permission'],
          },
          {
            id: 'agenda_stated',
            label: 'Nêu mục đích liên quan',
            score: 90,
            requiredBehaviorIds: [
              'recall_previous',
              'ask_permission',
              'state_agenda',
            ],
          },
          {
            id: 'agenda_confirmed',
            label: 'Kết nối và thống nhất nội dung',
            score: 100,
            requiredBehaviorIds: [
              'recall_previous',
              'ask_permission',
              'state_agenda',
              'confirm_agenda',
            ],
          },
        ],
        criticalErrors: sharedCriticalErrors,
      },
    },
    {
      competencyCode: 'needs_discovery',
      weight: 30,
      defaultRubric: discovery([
        {
          id: 'changed_situation',
          description:
            'Hỏi điều gì đã thay đổi từ lần trao đổi trước bằng câu hỏi mở.',
        },
        {
          id: 'decision_context',
          description: 'Làm rõ quyết định đang ở đâu và ai cùng tham gia.',
        },
      ]),
    },
    {
      competencyCode: 'value_articulation',
      weight: 15,
      defaultRubric: valuePositioning,
    },
    {
      competencyCode: 'objection_handling',
      weight: 25,
      defaultRubric: objectionHandling(
        'Phản hồi cụ thể theo lý do thật đằng sau lời trì hoãn, tôn trọng vai trò và ý kiến của vợ/chồng hoặc gia đình.',
      ),
    },
    {
      competencyCode: 'next_step_closing',
      weight: 20,
      defaultRubric: nextStep('ví dụ: xem nhà cùng vợ/chồng vào ngày cụ thể'),
    },
  ],
}

export const COMPETENCY_CATALOGUE = [
  { code: 'opening_hook', name: 'Mở đầu cuộc gọi' },
  {
    code: 'reconnect_agenda',
    name: 'Kết nối lại & mục đích',
  },
  { code: 'needs_discovery', name: 'Khám phá nhu cầu' },
  { code: 'value_articulation', name: 'Định vị giá trị' },
  { code: 'objection_handling', name: 'Xử lý phản đối' },
  {
    code: 'next_step_closing',
    name: 'Chốt bước tiếp theo',
  },
] as const
