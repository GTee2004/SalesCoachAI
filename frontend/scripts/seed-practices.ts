import 'dotenv/config'
import { isDeepStrictEqual } from 'node:util'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../src/db/index.ts'
import {
  competencies,
  practiceAgentConfigs,
  practiceCompetencies,
  practices,
  salesOfferings,
} from '../src/db/schema.ts'
import type {
  LearnerBrief,
  PracticeAgentConfig,
  SalesOfferingConfig,
} from '../src/db/schema.ts'
import {
  COMPETENCY_CATALOGUE,
  SCORECARD_TEMPLATES,
} from '../src/lib/practice/scorecards'
import {
  agentConfigSchema,
  learnerBriefSchema,
  rubricSchema,
  salesOfferingSchema,
} from '../src/lib/practice/validation'
import { publishPractice } from '../src/lib/server/practice-domain'

// Shared by The Paris units on the developer's price list.
const theParisPaymentPlan: SalesOfferingConfig['paymentPlan'] = {
  summary:
    'Thanh toán tối đa 50% trước khi nhận nhà, chia thành các đợt nhỏ 2–3% theo tiến độ xây dựng; hoặc vay ngân hàng đến 70%.',
  milestones: [
    { label: 'Ký hợp đồng mua bán', percent: 10, timing: 'Sau đặt cọc' },
    {
      label: 'Các đợt theo tiến độ',
      percent: 40,
      timing: '13 đợt, mỗi đợt 2–3%, đến trước bàn giao',
    },
    { label: 'Nhận nhà', percent: 45, timing: 'Quý I/2027' },
    { label: 'Nhận sổ hồng', percent: 5, timing: 'Khi bàn giao sổ' },
  ],
  loanSupport:
    'Vay đến 70% giá trị căn hộ, hỗ trợ lãi suất 0% và ân hạn nợ gốc 24 tháng; sau đó lãi suất thả nổi theo ngân hàng.',
  promotions: ['Chiết khấu 1% nếu không nhận bảo lãnh ngân hàng'],
}

const offerings: Array<{
  key: string
  name: string
  offering: SalesOfferingConfig
}> = [
  // Reference prices from The Paris primary price list and Ocean Park 1 resale
  // listings, October 2026. The Paris is the only Ocean Park 1 subdivision
  // still sold by the developer; every other tower is resale only.
  {
    key: 'the-paris-2br',
    name: 'The Paris PR5 - 2PN 65m2 - 3,9 tỷ VND',
    offering: {
      productType: 'apartment',
      projectName: 'Vinhomes Ocean Park 1 - The Paris',
      developer: 'Vinhomes (liên doanh với Mitsubishi Corporation)',
      location: {
        district: 'Gia Lâm',
        city: 'Hà Nội',
        highlights: [
          'Trong khu đô thị có sẵn Vinschool, Vinmec, VinUni và Vincom Mega Mall',
          'Khoảng 20–25 phút lái xe vào trung tâm Hà Nội qua cầu Vĩnh Tuy',
          'Ngay cổng vào khu đô thị, gần Quốc lộ 5A và cao tốc Hà Nội – Hải Phòng',
        ],
      },
      unit: {
        bedrooms: 2,
        bathrooms: 2,
        areaM2: 65,
        floor: 'Tầng 18, tòa PR5 The Inspire',
        view: 'Hướng hồ nội khu',
        furnishing: 'Bàn giao nội thất cơ bản',
      },
      price: {
        amount: 3_900_000_000,
        currency: 'VND',
        pricePerM2: 60_000_000,
        note: 'Giá chủ đầu tư, đã gồm VAT, chưa gồm phí bảo trì 2%',
      },
      paymentPlan: theParisPaymentPlan,
      handover: 'Dự kiến quý I/2027',
      legalStatus: 'Sở hữu lâu dài, sổ hồng cấp sau khi bàn giao',
      asOf: '2026-10',
      keyStrengths: [
        'Mua trực tiếp chủ đầu tư, khoảng 60 triệu/m2, thấp hơn khoảng 5–10% so với căn 2PN chuyển nhượng đã có sổ trong cùng khu đô thị',
        'Tiện ích nội khu đã vận hành: trường học, bệnh viện, trung tâm thương mại, hồ trung tâm 24,5 ha',
        'Tiến độ thanh toán giãn, tối đa 50% trước khi nhận nhà',
      ],
      keyWeaknesses: [
        'Chưa có sổ hồng, phải chờ sau bàn giao',
        'Đường vào trung tâm qua cầu Vĩnh Tuy, Thanh Trì hay kẹt xe giờ cao điểm',
        'Hết 24 tháng hỗ trợ, lãi suất thả nổi theo ngân hàng',
      ],
      competitors: [
        {
          name: 'Căn 2PN chuyển nhượng tại The Sapphire 2',
          comparison:
            'Đã có sổ hồng và ở được ngay, nhưng giá cao hơn khoảng 5–10% và phải thanh toán gần như toàn bộ khi sang tên',
        },
      ],
    },
  },
  {
    key: 'the-paris-1br',
    name: 'The Paris PR5 - 1PN 43m2 - 2,75 tỷ VND',
    offering: {
      productType: 'apartment',
      projectName: 'Vinhomes Ocean Park 1 - The Paris',
      developer: 'Vinhomes (liên doanh với Mitsubishi Corporation)',
      location: {
        district: 'Gia Lâm',
        city: 'Hà Nội',
        highlights: [
          'Nguồn khách thuê từ sinh viên, giảng viên VinUni, giáo viên Vinschool và chuyên gia các khu công nghiệp phía đông',
          'Khoảng 20–25 phút lái xe vào trung tâm Hà Nội qua cầu Vĩnh Tuy',
        ],
      },
      unit: {
        bedrooms: 1,
        bathrooms: 1,
        areaM2: 43,
        floor: 'Tầng 11, tòa PR5 The Inspire',
        view: 'Hướng nội khu',
        furnishing: 'Bàn giao nội thất cơ bản',
      },
      price: {
        amount: 2_750_000_000,
        currency: 'VND',
        pricePerM2: 63_953_488,
        note: 'Giá chủ đầu tư, đã gồm VAT, chưa gồm phí bảo trì 2%',
      },
      paymentPlan: {
        summary:
          'Thanh toán tối đa 50% trước khi nhận nhà, chia thành các đợt nhỏ 2–3% theo tiến độ xây dựng; hoặc vay ngân hàng đến 70%.',
        loanSupport:
          'Vay đến 70% giá trị căn hộ, hỗ trợ lãi suất 0% và ân hạn nợ gốc 24 tháng; sau đó lãi suất thả nổi theo ngân hàng.',
      },
      handover: 'Dự kiến quý I/2027',
      legalStatus: 'Sở hữu lâu dài, sổ hồng cấp sau khi bàn giao',
      asOf: '2026-10',
      keyStrengths: [
        'Giá thuê căn 1PN trong khu khoảng 9.000.000 VND/tháng, lợi suất gộp khoảng 4%',
        'Mức vốn vào thấp, tối đa 50% trước khi nhận nhà',
        'Căn hộ trong khu đô thị đã có cộng đồng cư dân, dễ cho thuê và chuyển nhượng lại',
      ],
      keyWeaknesses: [
        'Lợi suất gộp chỉ khoảng 4%, còn thấp hơn sau khi trừ phí quản lý, bảo trì và thời gian trống phòng',
        'Bàn giao nội thất cơ bản, cần thêm khoảng 150–200 triệu làm nội thất trước khi cho thuê',
        'Nguồn cung căn hộ cho thuê trong khu đô thị lớn, phải cạnh tranh giá thuê',
      ],
    },
  },
  {
    key: 'the-paris-studio',
    name: 'The Paris PR5 - Studio 29m2 - 2 tỷ VND',
    offering: {
      productType: 'apartment',
      projectName: 'Vinhomes Ocean Park 1 - The Paris',
      developer: 'Vinhomes (liên doanh với Mitsubishi Corporation)',
      location: {
        district: 'Gia Lâm',
        city: 'Hà Nội',
        highlights: [
          'Nguồn khách thuê từ sinh viên, giảng viên VinUni và người đi làm độc thân',
          'Khoảng 20–25 phút lái xe vào trung tâm Hà Nội qua cầu Vĩnh Tuy',
        ],
      },
      unit: {
        bedrooms: 0,
        bathrooms: 1,
        areaM2: 29,
        floor: 'Tầng 9, tòa PR5 The Inspire',
        view: 'Hướng nội khu',
        furnishing: 'Bàn giao nội thất cơ bản',
      },
      price: {
        amount: 2_000_000_000,
        currency: 'VND',
        pricePerM2: 68_965_517,
        note: 'Giá chủ đầu tư, đã gồm VAT, chưa gồm phí bảo trì 2%',
      },
      paymentPlan: theParisPaymentPlan,
      handover: 'Dự kiến quý I/2027',
      legalStatus: 'Sở hữu lâu dài, sổ hồng cấp sau khi bàn giao',
      asOf: '2026-10',
      keyStrengths: [
        'Vốn vào thấp nhất dự án, khoảng 2 tỷ, tối đa 50% trước khi nhận nhà',
        'Giá thuê studio trong khu khoảng 6.000.000 VND/tháng, lợi suất gộp khoảng 3,6%',
        'Dễ chuyển nhượng lại vì tổng giá thấp, nhiều người mua lần đầu quan tâm',
      ],
      keyWeaknesses: [
        'Diện tích nhỏ, chỉ phù hợp 1–2 người',
        'Đơn giá khoảng 69 triệu/m2, cao hơn căn nhiều phòng ngủ',
        'Nguồn cung studio cho thuê trong khu đô thị nhiều, phải cạnh tranh giá thuê',
        'Chưa có sổ hồng, phải chờ sau bàn giao',
      ],
    },
  },
  {
    key: 'the-paris-1br-plus',
    name: 'The Paris PR5 - 1PN+1 50m2 - 3,1 tỷ VND',
    offering: {
      productType: 'apartment',
      projectName: 'Vinhomes Ocean Park 1 - The Paris',
      developer: 'Vinhomes (liên doanh với Mitsubishi Corporation)',
      location: {
        district: 'Gia Lâm',
        city: 'Hà Nội',
        highlights: [
          'Trong khu đô thị có sẵn Vinschool, Vinmec, VinUni và Vincom Mega Mall',
          'Khoảng 20–25 phút lái xe vào trung tâm Hà Nội qua cầu Vĩnh Tuy',
        ],
      },
      unit: {
        bedrooms: 1,
        bathrooms: 1,
        areaM2: 50,
        floor: 'Tầng 15, tòa PR5 The Inspire',
        view: 'Hướng hồ nội khu',
        furnishing: 'Bàn giao nội thất cơ bản, có thêm phòng nhỏ đa năng',
      },
      price: {
        amount: 3_100_000_000,
        currency: 'VND',
        pricePerM2: 62_000_000,
        note: 'Giá chủ đầu tư, đã gồm VAT, chưa gồm phí bảo trì 2%',
      },
      paymentPlan: theParisPaymentPlan,
      handover: 'Dự kiến quý I/2027',
      legalStatus: 'Sở hữu lâu dài, sổ hồng cấp sau khi bàn giao',
      asOf: '2026-10',
      keyStrengths: [
        'Phòng phụ dùng làm phòng làm việc hoặc phòng cho em bé',
        'Tổng giá khoảng 3,1 tỷ, vừa sức vợ chồng trẻ mua căn đầu tiên',
        'Tiện ích nội khu đã vận hành: trường học, bệnh viện, trung tâm thương mại',
      ],
      keyWeaknesses: [
        'Phòng phụ nhỏ, không đủ làm phòng ngủ riêng khi con lớn',
        'Chưa có sổ hồng, phải chờ sau bàn giao',
        'Hết 24 tháng hỗ trợ, lãi suất thả nổi theo ngân hàng',
      ],
    },
  },
  {
    key: 'the-paris-3br',
    name: 'The Paris PR5 - 3PN 90m2 - 5,6 tỷ VND',
    offering: {
      productType: 'apartment',
      projectName: 'Vinhomes Ocean Park 1 - The Paris',
      developer: 'Vinhomes (liên doanh với Mitsubishi Corporation)',
      location: {
        district: 'Gia Lâm',
        city: 'Hà Nội',
        highlights: [
          'Vinschool liên cấp và bệnh viện Vinmec ngay trong khu đô thị',
          'Hồ trung tâm 24,5 ha và công viên cho người cao tuổi đi bộ hằng ngày',
          'Khoảng 20–25 phút lái xe vào trung tâm Hà Nội qua cầu Vĩnh Tuy',
        ],
      },
      unit: {
        bedrooms: 3,
        bathrooms: 2,
        areaM2: 90,
        floor: 'Tầng 20, tòa PR5 The Inspire',
        view: 'Căn góc, hướng hồ nội khu',
        furnishing: 'Bàn giao nội thất cơ bản',
      },
      price: {
        amount: 5_600_000_000,
        currency: 'VND',
        pricePerM2: 62_222_222,
        note: 'Giá chủ đầu tư, đã gồm VAT, chưa gồm phí bảo trì 2%',
      },
      paymentPlan: theParisPaymentPlan,
      handover: 'Dự kiến quý I/2027',
      legalStatus: 'Sở hữu lâu dài, sổ hồng cấp sau khi bàn giao',
      asOf: '2026-10',
      keyStrengths: [
        'Đủ chỗ cho gia đình ba thế hệ, có phòng riêng cho ông bà',
        'Căn góc hai mặt thoáng, đơn giá khoảng 62 triệu/m2',
        'Trường học và bệnh viện trong khu đô thị, không phải đi xa',
      ],
      keyWeaknesses: [
        'Tổng giá cao, khoản vay lớn nếu không có sẵn vốn',
        'Quỹ căn 3PN ít, lựa chọn tầng và hướng hạn chế',
        'Chưa có sổ hồng, phải chờ sau bàn giao',
        'Đường vào trung tâm qua cầu Vĩnh Tuy, Thanh Trì hay kẹt xe giờ cao điểm',
      ],
      competitors: [
        {
          name: 'Căn 3PN chuyển nhượng tại The Sapphire',
          comparison:
            'Đã có sổ hồng và ở được ngay, giá khoảng 5 tỷ nhưng diện tích chỉ khoảng 75 m2',
        },
      ],
    },
  },
  // Masterise price list of January 2026 and sales policy of September 2026.
  // Built by Masterise inside Vinhomes Global Gate, not by Vinhomes itself.
  {
    key: 'essence-peak-2br',
    name: 'Lumière Essence Peak - 2PN 64,5m2 - 8,9 tỷ VND',
    offering: {
      productType: 'apartment',
      projectName: 'Lumière Essence Peak - Vinhomes Global Gate',
      developer: 'Masterise Homes',
      location: {
        district: 'Đông Anh',
        city: 'Hà Nội',
        highlights: [
          'Trong khu đô thị Vinhomes Global Gate, cạnh hồ 32 ha',
          'Gần đại lộ Võ Nguyên Giáp, khoảng 15 phút đến sân bay Nội Bài',
        ],
      },
      unit: {
        bedrooms: 2,
        bathrooms: 2,
        areaM2: 64.5,
        floor: 'Tầng trung',
        view: 'Hướng đại lộ',
        furnishing:
          'Bàn giao hoàn thiện nội thất liền tường và thiết bị cao cấp',
      },
      price: {
        amount: 8_900_000_000,
        currency: 'VND',
        pricePerM2: 137_984_496,
        note: 'Giá niêm yết đã gồm VAT, chưa trừ chiết khấu theo phương án thanh toán, chưa gồm phí bảo trì 2%',
      },
      paymentPlan: {
        summary:
          'Ba phương án: thanh toán sớm chiết khấu 17%, thanh toán theo tiến độ khoảng 10% mỗi quý chiết khấu 8%, hoặc vay ngân hàng đến 70%.',
        milestones: [
          { label: 'Đặt cọc', percent: 0, timing: '50 triệu khi chọn căn' },
          {
            label: 'Ký thỏa thuận đặt cọc',
            percent: 10,
            timing: 'Sau 7 ngày đặt cọc',
          },
          { label: 'Đợt 2', percent: 10, timing: 'Trong khoảng 2 tháng' },
          {
            label: 'Ký hợp đồng mua bán',
            percent: 10,
            timing: 'Khi đủ điều kiện ký HĐMB',
          },
          {
            label: 'Thanh toán sớm',
            percent: 70,
            timing: 'Trong 30 ngày sau ký HĐMB',
          },
        ],
        loanSupport:
          'Vay đến 70% qua Vietcombank, BIDV, Techcombank hoặc Agribank, hỗ trợ lãi suất 0% đến tháng 3/2029; giải ngân tùy thẩm định của ngân hàng.',
        promotions: [
          'Chiết khấu 17% nếu thanh toán sớm',
          'Chiết khấu 8% nếu thanh toán theo tiến độ',
          'Ưu đãi thêm 1% cho cư dân Masterise Homes',
        ],
      },
      handover: 'Dự kiến quý III/2028',
      legalStatus: 'Sở hữu lâu dài, sổ hồng cấp sau khi bàn giao',
      asOf: '2026-10',
      keyStrengths: [
        'Căn hộ hạng sang cạnh hồ 32 ha trong đại đô thị Vinhomes Global Gate',
        'Chiết khấu thanh toán sớm đến 17%, giá thực trả thấp hơn đáng kể giá niêm yết',
        'Thương hiệu Masterise, bàn giao hoàn thiện cao cấp',
      ],
      keyWeaknesses: [
        'Đơn giá cao, khoảng 130–160 triệu/m2 cho căn view đại lộ',
        'Bàn giao quý III/2028, phải chờ gần 2 năm',
        'Căn view hồ đắt hơn 5–8%; căn này view đại lộ',
        'Hạ tầng và tiện ích khu đô thị còn đang hoàn thiện',
      ],
      competitors: [
        {
          name: 'Căn 2PN The Paris - Vinhomes Ocean Park 1',
          comparison:
            'Giá khoảng 3,9 tỷ và bàn giao quý I/2027, nhưng là phân khúc trung cấp, không cạnh hồ lớn',
        },
      ],
    },
  },
]

type Seed = {
  slug: string
  type: 'cold_call' | 'warm_call'
  offering: string
  title: string
  description: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  minutes: number
  tags: string[]
  brief: LearnerBrief
  config: PracticeAgentConfig
}

const commonRules = [
  'Chỉ biết về sản phẩm những gì người gọi nói; không tự đọc thông tin dự án.',
  'Nếu người gọi nói sai giá hoặc chính sách, hỏi lại hoặc tỏ ra nghi ngờ.',
  'Không đồng ý mua hay đặt cọc trong cuộc gọi này.',
]

const seeds: Seed[] = [
  {
    slug: 'cold-call-first-home-family',
    type: 'cold_call',
    offering: 'the-paris-2br',
    title: 'Gọi lần đầu - Anh Minh',
    description:
      'Gọi cho khách vừa để lại số trên landing page, mở đầu cuộc gọi và hẹn xem nhà mẫu.',
    difficulty: 'beginner',
    minutes: 5,
    tags: ['cold_call', 'own_use', 'family_buyer'],
    brief: {
      background:
        'Anh Minh để lại số điện thoại trên landing page The Paris - Vinhomes Ocean Park tối qua. Đây là lần đầu bạn gọi cho anh.',
      leadSource: 'Form đăng ký nhận bảng giá trên Facebook Ads',
      objective:
        'Hẹn được anh Minh (và vợ nếu có) đến xem nhà mẫu vào một ngày giờ cụ thể.',
    },
    config: {
      kind: 'cold_call',
      buyer: {
        name: 'Minh',
        addressTerm: 'anh',
        gender: 'male',
        age: 34,
        occupation: 'Kỹ sư phần mềm',
        familySituation:
          'Đã có vợ và một con 3 tuổi, đang thuê nhà ở Long Biên',
        motivation: {
          type: 'own_use',
          detail: 'Muốn mua căn hộ đầu tiên để ở trước khi con vào tiểu học.',
        },
        budget: {
          min: 3_400_000_000,
          max: 4_200_000_000,
          currency: 'VND',
          fundingSource:
            'Tiết kiệm 1.300.000.000 VND, phần còn lại vay ngân hàng',
        },
        priorities: [
          'Gần trường học cho con',
          'Khoản trả góp hàng tháng dưới 22 triệu',
          'Pháp lý rõ ràng',
        ],
        decisionMaker: {
          role: 'joint_with_spouse',
          detail: 'Vợ anh quyết định cùng, đặc biệt về vị trí.',
        },
        urgency: {
          level: 'medium',
          timeline: 'Trong 6 tháng tới',
          driver: 'Hợp đồng thuê nhà hết hạn tháng 3',
        },
        emotionalState: 'guarded',
        communicationStyle: ['Trả lời ngắn', 'Hỏi thẳng về giá'],
      },
      learnerKnows: ['age'],
      privateBackground:
        'Anh đã nhận nhiều cuộc gọi môi giới trong tuần và hơi mệt vì bị làm phiền. Đang bận làm việc lúc nhận cuộc gọi.',
      recollection:
        'Tối qua lướt Facebook thấy quảng cáo và để lại số để xem bảng giá, nhưng không nhớ rõ tên dự án.',
      hiddenInsights: [
        {
          key: 'lease_ends',
          insight:
            'Chủ nhà đã báo không gia hạn sau tháng 3; nếu chưa có nhà trước đó cả nhà phải chuyển chỗ thuê tạm giữa năm học của con.',
          revealGuidance: 'Chỉ nói khi được hỏi về thời điểm muốn chuyển nhà.',
          relatesTo: 'urgency',
        },
        {
          key: 'monthly_payment_limit',
          insight:
            'Mỗi tháng anh còn gửi tiền nuôi bố mẹ ở quê, nên trả góp vượt 22 triệu là gia đình không kham nổi.',
          revealGuidance: 'Nói khi được hỏi về tài chính hoặc cách thanh toán.',
          relatesTo: 'budget',
        },
        {
          key: 'wife_decides_location',
          insight:
            'Vợ anh muốn ở gần nhà ngoại ở Long Biên để ông bà đón cháu; chỉ đồng ý Gia Lâm nếu đi lại dưới 20 phút.',
          revealGuidance:
            'Nói khi được hỏi ai cùng quyết định hoặc khi được mời xem nhà.',
          relatesTo: 'decisionMaker',
        },
      ],
      objections: [
        {
          key: 'busy_now',
          category: 'brush_off',
          sampleWording: 'Anh đang bận, em gọi có việc gì?',
          underlyingReason:
            'Đang họp và nghĩ đây là cuộc gọi chào hàng như mọi cuộc khác.',
          raiseGuidance:
            'Nêu ngay sau khi người gọi giới thiệu nếu chưa nói lý do gọi liên quan đến anh.',
          resolutionGuidance:
            'Dịu lại nếu người gọi nhắc đúng form anh đăng ký và xin 2 phút; nếu không, cúp máy lịch sự.',
        },
        {
          key: 'no_certificate',
          category: 'trust',
          sampleWording: 'Chưa có sổ hồng thì anh không yên tâm lắm.',
          underlyingReason: 'Bạn bè từng mua dự án chậm ra sổ.',
          raiseGuidance:
            'Nêu khi người gọi nói về pháp lý hoặc khi được mời đặt cọc.',
          resolutionGuidance:
            'Yên tâm hơn nếu người gọi giải thích rõ giấy phép và tiến độ ra sổ, không hứa suông.',
        },
      ],
      hangUpGuidance:
        'Cúp máy nếu người gọi đọc kịch bản chào hàng dài hơn 30 giây mà không hỏi gì, hoặc vẫn ép sau khi anh từ chối hai lần.',
      behaviorRules: [
        ...commonRules,
        'Lúc đầu trả lời cộc lốc; cởi mở hơn khi được hỏi về gia đình và nhu cầu.',
      ],
      successCriteria: [
        'Người gọi hẹn được ngày giờ cụ thể xem nhà mẫu.',
        'Người gọi mời cả vợ anh Minh cùng đi.',
      ],
    },
  },
  {
    slug: 'cold-call-busy-investor',
    type: 'cold_call',
    offering: 'the-paris-1br',
    title: 'Gọi lần đầu - Chị Hà',
    description:
      'Gọi cho nhà đầu tư bận rộn từ danh sách sự kiện, gây chú ý nhanh và hẹn gửi phân tích lợi suất.',
    difficulty: 'advanced',
    minutes: 5,
    tags: ['cold_call', 'investment', 'impatient'],
    brief: {
      background:
        'Chị Hà tham dự hội thảo đầu tư bất động sản tháng trước và để lại danh thiếp. Chị chưa từng nói chuyện với bạn.',
      leadSource: 'Danh sách khách tham dự hội thảo đầu tư',
      objective:
        'Được chị Hà đồng ý nhận bảng phân tích dòng tiền cho thuê qua Zalo và hẹn gọi lại trao đổi.',
    },
    config: {
      kind: 'cold_call',
      buyer: {
        name: 'Hà',
        addressTerm: 'chị',
        gender: 'female',
        age: 45,
        occupation: 'Chủ chuỗi spa',
        familySituation: 'Đã có 2 căn hộ cho thuê ở Long Biên',
        motivation: {
          type: 'investment',
          detail:
            'Tìm căn cho thuê có dòng tiền đều, lợi suất từ 4% trở lên và giữ giá tốt.',
        },
        budget: {
          max: 3_000_000_000,
          currency: 'VND',
          fundingSource: 'Tiền mặt, không muốn vay',
        },
        priorities: [
          'Lợi suất cho thuê',
          'Thanh khoản khi bán lại',
          'Không phải tự quản lý khách thuê',
        ],
        decisionMaker: { role: 'sole_decision_maker' },
        urgency: {
          level: 'low',
          timeline: 'Không vội, chờ cơ hội tốt',
        },
        emotionalState: 'impatient',
        communicationStyle: ['Nói nhanh', 'Hay ngắt lời', 'Thích số liệu'],
      },
      learnerKnows: ['occupation'],
      privateBackground:
        'Chị đang lái xe đến cửa hàng. Chị đã có kinh nghiệm đầu tư và ghét môi giới nói chung chung.',
      recollection:
        'Nhớ mơ hồ đã đi một hội thảo đầu tư nhưng không nhớ ai hay dự án nào.',
      hiddenInsights: [
        {
          key: 'cash_buyer',
          insight:
            'Chị có sẵn khoảng 3 tỷ tiền mặt từ việc bán một lô đất, nên có thể quyết nhanh nếu gặp căn đúng tiêu chí.',
          revealGuidance: 'Chỉ nói khi được hỏi về cách thanh toán.',
          relatesTo: 'budget',
        },
        {
          key: 'hates_self_managing',
          insight:
            'Khách thuê căn Long Biên vừa bỏ đi, nợ 3 tháng tiền nhà, nên chị rất ngại phải tự quản lý khách thuê thêm lần nữa.',
          revealGuidance: 'Nói khi được hỏi về kinh nghiệm cho thuê hiện tại.',
          relatesTo: 'priorities',
        },
      ],
      objections: [
        {
          key: 'not_interested',
          category: 'not_interested',
          sampleWording: 'Chị có đủ nhà rồi, không quan tâm đâu em.',
          raiseGuidance: 'Nêu ngay sau lời giới thiệu.',
          resolutionGuidance:
            'Chỉ nghe tiếp nếu người gọi nêu một con số lợi suất cụ thể hoặc câu hỏi đáng suy nghĩ trong 1–2 câu.',
        },
        {
          key: 'oversupply',
          category: 'product',
          sampleWording:
            'Ocean Park giờ căn hộ cho thuê nhiều lắm, lợi suất gì nổi.',
          underlyingReason: 'Đã đọc tin về nguồn cung tăng.',
          raiseGuidance: 'Nêu khi người gọi nói về lợi suất.',
          resolutionGuidance:
            'Chấp nhận nếu người gọi thừa nhận rủi ro và nêu điểm khác biệt (căn mới, nguồn khách thuê từ trường học và khu công nghiệp lân cận).',
        },
      ],
      openingLine: 'Alo, ai đấy?',
      hangUpGuidance:
        'Cúp máy nếu sau khoảng 40 giây người gọi vẫn chưa nêu được lý do đáng nghe.',
      behaviorRules: [
        ...commonRules,
        'Ngắt lời nếu người gọi nói dài hơn 3 câu liên tiếp.',
      ],
      successCriteria: [
        'Chị Hà đồng ý nhận bảng phân tích qua Zalo.',
        'Hẹn được thời điểm gọi lại cụ thể.',
      ],
    },
  },
  {
    slug: 'warm-call-spouse-discussion',
    type: 'warm_call',
    offering: 'the-paris-2br',
    title: 'Gọi lại - Chị Lan',
    description:
      'Gọi lại sau khi chị Lan nói cần bàn với chồng; tìm lý do thật và hẹn cả hai vợ chồng xem nhà.',
    difficulty: 'intermediate',
    minutes: 7,
    tags: ['warm_call', 'own_use', 'spouse_decision'],
    brief: {
      background:
        'Tuần trước bạn đã gọi và giới thiệu căn 2PN The Paris - Vinhomes Ocean Park. Chị Lan thích căn hộ nhưng nói cần bàn với chồng. Đây là cuộc gọi lại như đã hẹn.',
      previousInteractions: [
        {
          when: 'Thứ Năm tuần trước',
          channel: 'phone',
          summary:
            'Chị Lan hỏi kỹ về trường học xung quanh và tiến độ thanh toán, thích căn hướng hồ.',
          agreedNextStep: 'Gọi lại đầu tuần này sau khi chị bàn với chồng.',
        },
        {
          when: 'Sau cuộc gọi thứ Năm tuần trước',
          channel: 'zalo',
          summary:
            'Bạn đã gửi bảng giá và tiến độ thanh toán; chị Lan đã nhận.',
        },
      ],
      objective:
        'Tìm ra băn khoăn thật của chồng chị Lan và hẹn được cả hai vợ chồng đến xem nhà mẫu.',
    },
    config: {
      kind: 'warm_call',
      buyer: {
        name: 'Lan',
        addressTerm: 'chị',
        gender: 'female',
        age: 38,
        occupation: 'Giáo viên',
        familySituation: 'Chồng làm kinh doanh, hai con 7 và 10 tuổi',
        motivation: {
          type: 'own_use',
          detail: 'Mua căn hộ để ở gần trường của hai con.',
        },
        budget: {
          max: 4_000_000_000,
          currency: 'VND',
          fundingSource: 'Bán mảnh đất ở quê và vay thêm',
        },
        priorities: [
          'Gần trường của con',
          'Khoản trả góp ổn định',
          'Không gian cho hai con',
        ],
        decisionMaker: {
          role: 'joint_with_spouse',
          detail: 'Chồng chị nắm tài chính và có tiếng nói cuối cùng.',
        },
        urgency: {
          level: 'medium',
          timeline: 'Trước năm học mới',
        },
        emotionalState: 'neutral',
      },
      learnerKnows: ['age', 'occupation', 'motivation', 'budget.max'],
      privateBackground:
        'Chị vẫn thích căn hộ nhưng sau khi nói chuyện, chồng chị lo khoản vay khi lãi suất thả nổi.',
      recollection:
        'Nhớ người gọi tư vấn nhiệt tình, đã gửi bảng giá; chị hẹn sẽ bàn với chồng.',
      sinceLastContact:
        'Chồng chị lo lãi suất tăng sau 24 tháng hỗ trợ, và mảnh đất ở quê chưa bán được.',
      hiddenInsights: [
        {
          key: 'husband_rate_worry',
          insight: 'Chồng lo lãi suất thả nổi làm khoản trả góp tăng mạnh.',
          revealGuidance:
            'Chỉ nói khi người gọi hỏi cụ thể anh nhà băn khoăn điều gì.',
          relatesTo: 'decisionMaker',
        },
        {
          key: 'land_not_sold',
          insight:
            'Mảnh đất ở quê chưa bán được nên nguồn vốn ban đầu chưa chắc.',
          revealGuidance:
            'Nói khi được hỏi về nguồn vốn hoặc thời điểm thanh toán.',
          relatesTo: 'budget.fundingSource',
        },
      ],
      objections: [
        {
          key: 'think_more',
          category: 'timing',
          sampleWording: 'Nhà chị vẫn đang suy nghĩ thêm em ạ.',
          underlyingReason: 'Che giấu băn khoăn về lãi suất của chồng.',
          raiseGuidance: 'Nêu khi người gọi hỏi chị đã quyết định chưa.',
          resolutionGuidance:
            'Chia sẻ lý do thật nếu người gọi hỏi nhẹ nhàng, không ép.',
        },
        {
          key: 'husband_disagrees',
          category: 'decision_authority',
          sampleWording: 'Anh nhà chị chưa đồng ý lắm.',
          underlyingReason: 'Lo lãi suất thả nổi.',
          raiseGuidance: 'Nêu sau lời trì hoãn nếu người gọi hỏi tiếp.',
          resolutionGuidance:
            'Đồng ý hẹn cả hai vợ chồng nếu người gọi đề nghị trình bày phương án trả góp cho anh.',
        },
      ],
      openingLine: 'Alo, chị nghe đây em.',
      behaviorRules: [
        ...commonRules,
        'Thân thiện nhưng tránh chủ đề chồng không đồng ý cho đến khi được hỏi khéo.',
      ],
      successCriteria: [
        'Người gọi phát hiện chồng chị lo lãi suất.',
        'Hẹn được cả hai vợ chồng xem nhà mẫu hoặc gặp tư vấn tài chính vào ngày cụ thể.',
      ],
    },
  },
  {
    slug: 'warm-call-competitor-comparison',
    type: 'warm_call',
    offering: 'the-paris-2br',
    title: 'Gọi lại sau khi xem nhà - Chú Tuấn',
    description:
      'Gọi lại khách đã xem nhà mẫu và đang so sánh với một căn chuyển nhượng đã có sổ.',
    difficulty: 'advanced',
    minutes: 8,
    tags: ['warm_call', 'mixed', 'competitor'],
    brief: {
      background:
        'Chú Tuấn đã xem nhà mẫu The Paris cuối tuần trước và khen căn hướng hồ. Bạn gọi lại để biết chú đã quyết định chưa.',
      previousInteractions: [
        {
          when: 'Chủ nhật tuần trước',
          channel: 'showroom',
          summary:
            'Chú xem căn 2PN tầng 18, hỏi nhiều về pháp lý và chất lượng xây dựng.',
          agreedNextStep: 'Gọi lại trong tuần để trả lời câu hỏi về sổ hồng.',
        },
      ],
      objective:
        'Giữ chú Tuấn cân nhắc căn The Paris và hẹn buổi gặp để so sánh hai lựa chọn.',
    },
    config: {
      kind: 'warm_call',
      buyer: {
        name: 'Tuấn',
        addressTerm: 'chú',
        gender: 'male',
        age: 58,
        occupation: 'Cán bộ hưu trí',
        familySituation: 'Con trai 28 tuổi sắp cưới vợ',
        motivation: {
          type: 'mixed',
          detail: 'Mua cho con trai ở, sau này có thể cho thuê.',
        },
        budget: {
          max: 4_300_000_000,
          currency: 'VND',
          fundingSource: 'Tiền tiết kiệm của hai vợ chồng',
        },
        priorities: ['Pháp lý an toàn', 'Chất lượng xây dựng', 'Giá hợp lý'],
        decisionMaker: {
          role: 'family_decision',
          detail: 'Con trai và con dâu tương lai cũng có ý kiến.',
        },
        urgency: {
          level: 'high',
          timeline: 'Trước đám cưới trong 4 tháng',
          driver: 'Con trai cưới vợ',
        },
        emotionalState: 'friendly',
      },
      learnerKnows: ['age', 'motivation'],
      privateBackground:
        'Sau khi xem nhà, một người quen giới thiệu căn 2PN chuyển nhượng ở The Sapphire 2 trong cùng khu đô thị, đã có sổ, giá cao hơn khoảng 8%.',
      recollection:
        'Nhớ người gọi dẫn đi xem nhà mẫu, chú thích căn hướng hồ nhưng lo chưa có sổ.',
      sinceLastContact:
        'Chú đã đi xem căn Sapphire 2 và đang nghiêng về bên đó vì có sổ, ở được ngay.',
      hiddenInsights: [
        {
          key: 'wedding_deadline',
          insight:
            'Chú đã hứa với con sẽ có nhà cho vợ chồng trẻ dọn vào ngay sau cưới, nên thời điểm có nhà quan trọng hơn chênh lệch giá.',
          revealGuidance: 'Nói khi được hỏi về thời điểm cần nhà.',
          relatesTo: 'urgency',
        },
        {
          key: 'son_prefers_river',
          insight: 'Con trai thích căn mới, view hồ của The Paris hơn.',
          revealGuidance: 'Nói khi được hỏi ý kiến của con trai.',
          relatesTo: 'decisionMaker',
        },
      ],
      objections: [
        {
          key: 'competitor_has_certificate',
          category: 'competitor',
          sampleWording:
            'Căn bên Sapphire có sổ rồi, ở được ngay, chú thấy yên tâm hơn.',
          underlyingReason: 'Lo rủi ro pháp lý khi mua căn chưa có sổ.',
          raiseGuidance:
            'Nêu sớm, sau khi người gọi hỏi chú đã quyết định chưa.',
          resolutionGuidance:
            'Cân nhắc lại nếu người gọi so sánh công bằng, không chê căn kia, và nhắc đến thời điểm bàn giao so với đám cưới.',
        },
        {
          key: 'handover_timing',
          category: 'timing',
          sampleWording: 'Quý I/2027 mới giao nhà thì không kịp đám cưới.',
          raiseGuidance: 'Nêu khi người gọi nói về thời điểm bàn giao.',
          resolutionGuidance:
            'Chấp nhận nếu người gọi trung thực và đề xuất phương án phù hợp (ví dụ con thuê tạm), không hứa giao sớm.',
        },
      ],
      openingLine: 'Alo, chú nghe, ai đấy cháu?',
      behaviorRules: [
        ...commonRules,
        'Lịch sự, cởi mở nhưng rất coi trọng pháp lý.',
        'Mất thiện cảm nếu người gọi nói xấu căn chuyển nhượng hoặc người bán bên kia.',
      ],
      successCriteria: [
        'Người gọi xử lý được so sánh với đối thủ mà không chê bai.',
        'Hẹn được buổi gặp có cả con trai chú.',
      ],
    },
  },
  {
    slug: 'cold-call-referral-first-apartment',
    type: 'cold_call',
    offering: 'the-paris-1br',
    title: 'Gọi lần đầu - Chị Mai',
    description:
      'Liên hệ khách được giới thiệu, tìm hiểu nhu cầu căn hộ đầu tiên và hẹn trao đổi về phương án thanh toán.',
    difficulty: 'beginner',
    minutes: 5,
    tags: ['cold_call', 'own_use', 'referral'],
    brief: {
      background:
        'Anh Phúc, khách hàng cũ của bạn, cho biết chị Mai đã đồng ý để bạn liên hệ về căn 1PN The Paris - Vinhomes Ocean Park. Bạn chưa từng nói chuyện với chị.',
      leadSource: 'Khách hàng cũ giới thiệu, đã được chị Mai đồng ý liên hệ',
      objective:
        'Hẹn được một cuộc trao đổi về phương án thanh toán vào ngày giờ cụ thể.',
    },
    config: {
      kind: 'cold_call',
      buyer: {
        name: 'Mai',
        addressTerm: 'chị',
        gender: 'female',
        age: 29,
        occupation: 'Nhân viên kế toán',
        familySituation: 'Độc thân, đang thuê phòng tại Gia Lâm',
        motivation: {
          type: 'own_use',
          detail: 'Muốn có căn hộ đầu tiên để ở lâu dài thay vì thuê phòng.',
        },
        budget: {
          max: 2_900_000_000,
          currency: 'VND',
          fundingSource: 'Tiết kiệm 900 triệu, phần còn lại dự kiến vay',
        },
        priorities: [
          'Khoản trả góp vừa sức',
          'Gần chỗ làm',
          'Không gian riêng',
        ],
        decisionMaker: { role: 'sole_decision_maker' },
        urgency: {
          level: 'low',
          timeline: 'Có thể chờ đến khi dự án bàn giao',
        },
        emotionalState: 'friendly',
        communicationStyle: ['Hỏi kỹ', 'Cần giải thích thuật ngữ đơn giản'],
      },
      learnerKnows: [],
      privateBackground:
        'Tin lời giới thiệu của anh Phúc nhưng chưa từng vay mua nhà, nên sợ không hiểu hết các khoản phải trả.',
      recollection:
        'Anh Phúc đã nhắn sẽ có người gọi tư vấn căn 1PN, nhưng chị chưa nhận bảng giá.',
      hiddenInsights: [
        {
          key: 'variable_income',
          insight:
            'Một phần thu nhập là thưởng cuối năm; chị chỉ muốn tính khả năng trả nợ từ lương cố định 30 triệu mỗi tháng.',
          revealGuidance:
            'Nói khi được hỏi về thu nhập ổn định và mức trả góp.',
          relatesTo: 'budget',
        },
        {
          key: 'emergency_reserve',
          insight:
            'Trong 900 triệu tiết kiệm, chị muốn giữ lại 90 triệu dự phòng, không dùng toàn bộ cho tiền mua nhà.',
          revealGuidance:
            'Nói khi được hỏi số tiền thực sự có thể dùng ban đầu.',
          relatesTo: 'budget.fundingSource',
        },
      ],
      objections: [
        {
          key: 'loan_uncertainty',
          category: 'price',
          sampleWording: 'Chị chưa vay mua nhà bao giờ, sợ trả không nổi.',
          underlyingReason: 'Chưa hiểu gốc, lãi và chi phí ngoài giá bán.',
          raiseGuidance:
            'Nêu khi người gọi giới thiệu phương án vay ngân hàng.',
          resolutionGuidance:
            'Đồng ý trao đổi tiếp nếu người gọi hỏi khả năng chi trả, nói rõ cần tính cả phí và lãi sau ưu đãi, không cam kết ngân hàng chắc chắn duyệt vay.',
        },
        {
          key: 'send_first',
          category: 'brush_off',
          sampleWording: 'Em gửi bảng giá để chị đọc trước được không?',
          raiseGuidance: 'Nêu khi được đề nghị hẹn trao đổi.',
          resolutionGuidance:
            'Đồng ý hẹn sau khi nhận tài liệu nếu người gọi giải thích buổi trao đổi sẽ giúp chị hiểu tổng chi phí, không yêu cầu đặt cọc.',
        },
      ],
      openingLine: 'Alo, chị Mai nghe đây.',
      hangUpGuidance:
        'Kết thúc lịch sự nếu người gọi ép đặt cọc dù chị đã nói chưa hiểu phương án vay.',
      behaviorRules: [
        ...commonRules,
        'Không tự đưa ra toàn bộ thông tin tài chính; trả lời từng phần khi được hỏi.',
        'Không coi hỗ trợ lãi suất 0% và ân hạn nợ gốc 24 tháng là không phải trả nợ; muốn biết sau 24 tháng mỗi tháng trả bao nhiêu.',
      ],
      successCriteria: [
        'Chị đồng ý một ngày giờ cụ thể để trao đổi về phương án thanh toán.',
        'Hai bên thống nhất chị nhận bảng giá và thông tin chi phí trước buổi trao đổi.',
      ],
    },
  },
  {
    slug: 'cold-call-privacy-conscious-lead',
    type: 'cold_call',
    offering: 'the-paris-2br',
    title: 'Gọi lần đầu - Anh Hùng',
    description:
      'Gọi khách đăng ký nhận thông tin tại sự kiện, xin phép trao đổi và thống nhất thời điểm liên hệ tiếp.',
    difficulty: 'advanced',
    minutes: 5,
    tags: ['cold_call', 'own_use', 'event_lead'],
    brief: {
      background:
        'Anh Hùng đăng ký nhận thông tin The Paris - Vinhomes Ocean Park tại gian hàng của bạn ở hội chợ nhà ở cuối tuần. Đây là lần đầu bạn gọi cho anh.',
      leadSource: 'Phiếu đăng ký nhận thông tin tại hội chợ nhà ở',
      objective:
        'Được anh Hùng đồng ý nhận bảng giá qua kênh anh chọn và hẹn một cuộc gọi tư vấn vào ngày giờ cụ thể.',
    },
    config: {
      kind: 'cold_call',
      buyer: {
        name: 'Hùng',
        addressTerm: 'anh',
        gender: 'male',
        age: 41,
        occupation: 'Quản lý vận hành',
        familySituation: 'Đã có vợ và một con, đang ở cùng bố mẹ',
        motivation: {
          type: 'own_use',
          detail: 'Tìm căn 2PN để gia đình có không gian sinh hoạt riêng.',
        },
        budget: {
          max: 4_200_000_000,
          currency: 'VND',
          fundingSource: 'Tiết kiệm và vay ngân hàng',
        },
        priorities: [
          'Được tư vấn minh bạch',
          'Không gian cho gia đình',
          'Pháp lý',
        ],
        decisionMaker: { role: 'joint_with_spouse' },
        urgency: {
          level: 'low',
          timeline: 'Có thể chờ đến khi dự án bàn giao',
        },
        emotionalState: 'hostile',
        communicationStyle: ['Cộc lốc', 'Không thích nói dài'],
      },
      learnerKnows: [],
      privateBackground:
        'Vẫn có nhu cầu nhưng vừa bị nhiều môi giới gọi liên tục sau hội chợ, nên rất khó chịu khi thấy số lạ.',
      recollection:
        'Nhớ điền phiếu tại gian hàng The Paris để nhận bảng giá, không nhớ tên nhân viên.',
      hiddenInsights: [
        {
          key: 'contact_boundary',
          insight:
            'Anh chỉ muốn một người phụ trách liên hệ qua Zalo; nếu bị chuyển số cho nhiều môi giới sẽ ngừng trao đổi.',
          revealGuidance: 'Nói khi người gọi hỏi kênh và cách liên hệ phù hợp.',
          relatesTo: 'priorities',
        },
        {
          key: 'evening_availability',
          insight:
            'Anh làm theo ca và chỉ có thể trao đổi sau 19 giờ vào ngày nghỉ; gọi trong ca khiến anh mất tập trung.',
          revealGuidance: 'Nói khi người gọi xin hẹn một thời điểm thuận tiện.',
        },
      ],
      objections: [
        {
          key: 'number_source',
          category: 'trust',
          sampleWording: 'Em lấy số anh ở đâu? Sao cứ gọi hoài vậy?',
          underlyingReason: 'Sợ thông tin cá nhân bị chia sẻ không kiểm soát.',
          raiseGuidance:
            'Nêu ở lượt đầu tiên người gọi nói, kể cả khi họ mới chỉ nêu tên. Nếu ngay trong lượt đó họ đã tự nói vì sao có số của anh thì không hỏi lại.',
          resolutionGuidance:
            'Nghe tiếp nếu người gọi nói rõ phiếu đăng ký tại gian hàng, thừa nhận sự bất tiện và xin phép trao đổi ngắn; không viện cớ quen anh từ trước.',
        },
        {
          key: 'stop_sales_calls',
          category: 'brush_off',
          sampleWording: 'Anh không muốn nghe chào hàng lúc này.',
          raiseGuidance: 'Nêu nếu người gọi bắt đầu đọc thông tin dự án ngay.',
          resolutionGuidance:
            'Chỉ cân nhắc hẹn lại nếu người gọi dừng chào hàng, hỏi anh có muốn nhận bảng giá đã đăng ký không và để anh chọn thời điểm.',
        },
      ],
      openingLine: 'Alo, ai đấy?',
      hangUpGuidance:
        'Cúp máy nếu người gọi né câu hỏi nguồn số hoặc vẫn tiếp tục chào hàng sau khi anh yêu cầu dừng. Nếu anh yêu cầu không liên hệ nữa, không đồng ý hẹn lại.',
      behaviorRules: [
        ...commonRules,
        'Bớt gay gắt khi được giải thích nguồn liên hệ chính xác và được tôn trọng quyền từ chối.',
        'Không đồng ý nhận tài liệu hay hẹn lại chỉ vì người gọi xin lỗi mà chưa xin phép.',
      ],
      successCriteria: [
        'Anh chủ động đồng ý nhận bảng giá qua kênh đã chọn.',
        'Anh đồng ý một ngày giờ cụ thể cho cuộc gọi tư vấn tiếp theo.',
      ],
    },
  },
  {
    slug: 'warm-call-rental-cash-flow-review',
    type: 'warm_call',
    offering: 'the-paris-1br',
    title: 'Gọi lại - Anh Đức',
    description:
      'Gọi lại nhà đầu tư đã nhận phân tích cho thuê, cập nhật tiêu chí và hẹn buổi rà soát dòng tiền.',
    difficulty: 'intermediate',
    minutes: 7,
    tags: ['warm_call', 'investment', 'cash_flow'],
    brief: {
      background:
        'Bạn đã giới thiệu căn 1PN The Paris - Vinhomes Ocean Park cho anh Đức tuần trước và gửi bảng tính lợi suất gộp khoảng 4%. Bạn gọi lại theo lịch đã hẹn.',
      previousInteractions: [
        {
          when: 'Thứ Ba tuần trước',
          channel: 'phone',
          summary:
            'Anh Đức hỏi về giá căn 1PN và khả năng cho thuê, cho biết dự kiến dùng tiền mặt với ngân sách tối đa 3 tỷ.',
          agreedNextStep: 'Gửi bảng tính cho thuê và gọi lại sau một tuần.',
        },
        {
          when: 'Chiều thứ Ba tuần trước',
          channel: 'zalo',
          summary:
            'Bạn gửi bảng tính lợi suất gộp dựa trên giá thuê tham khảo 9.000.000 VND/tháng; anh xác nhận đã nhận.',
        },
      ],
      objective:
        'Hẹn được buổi rà soát bảng dòng tiền cho thuê vào ngày giờ cụ thể.',
    },
    config: {
      kind: 'warm_call',
      buyer: {
        name: 'Đức',
        addressTerm: 'anh',
        gender: 'male',
        age: 39,
        occupation: 'Chủ cửa hàng thiết bị điện',
        familySituation: 'Đã có nhà ở, đang tìm căn hộ đầu tư đầu tiên',
        motivation: {
          type: 'investment',
          detail: 'Muốn có nguồn thu cho thuê ổn định ngoài kinh doanh.',
        },
        budget: {
          max: 3_000_000_000,
          currency: 'VND',
          fundingSource: 'Tiền mặt từ lợi nhuận kinh doanh',
        },
        priorities: ['Dòng tiền thực nhận', 'Rủi ro trống phòng', 'Dễ quản lý'],
        decisionMaker: { role: 'sole_decision_maker' },
        urgency: {
          level: 'low',
          timeline: 'Chỉ mua khi hiểu rõ hiệu quả đầu tư',
        },
        emotionalState: 'guarded',
        communicationStyle: ['Yêu cầu số liệu có giả định rõ ràng'],
      },
      learnerKnows: ['motivation.type', 'budget.max', 'budget.fundingSource'],
      privateBackground:
        'Không muốn quyết định dựa trên lợi suất quảng cáo; cần biết tiền thực nhận và rủi ro sau bàn giao.',
      recollection:
        'Nhớ đã nhận bảng tính lợi suất gộp 4%, chưa có mô hình trừ chi phí hay thời gian trống phòng.',
      sinceLastContact:
        'Một người bạn cho anh xem chi phí sửa chữa và hai tháng trống phòng của căn cho thuê, khiến anh nghi ngờ con số lợi suất gộp.',
      hiddenInsights: [
        {
          key: 'net_yield_threshold',
          insight:
            'Anh chỉ thấy đáng đầu tư nếu lợi suất ròng còn khoảng 3% sau chi phí, nội thất và thời gian trống phòng, cộng với kỳ vọng tăng giá; thấp hơn thì muốn giữ tiền gửi ngân hàng.',
          revealGuidance:
            'Nói khi được hỏi tiêu chí đánh giá hiệu quả thực tế.',
          relatesTo: 'priorities',
        },
        {
          key: 'income_start_date',
          insight:
            'Anh ban đầu tưởng có thể cho thuê ngay sau khi ký, chưa tính khoảng thời gian chờ bàn giao không có thu nhập.',
          revealGuidance:
            'Nói khi người gọi hỏi lúc nào anh kỳ vọng có tiền thuê.',
          relatesTo: 'urgency',
        },
      ],
      objections: [
        {
          key: 'gross_not_net',
          category: 'trust',
          sampleWording:
            'Bốn phần trăm là chưa trừ gì, thực nhận còn bao nhiêu?',
          raiseGuidance: 'Nêu khi người gọi hỏi anh đã xem bảng tính chưa.',
          resolutionGuidance:
            'Đồng ý rà soát nếu người gọi phân biệt lợi suất gộp và ròng, đề xuất tính phí, bảo trì và trống phòng với giả định rõ; không bảo đảm giá thuê.',
        },
        {
          key: 'no_income_before_handover',
          category: 'timing',
          sampleWording:
            'Chờ đến quý I/2027 mới nhận nhà thì tiền của anh chưa tạo dòng thu à?',
          raiseGuidance: 'Nêu khi người gọi làm rõ thời điểm bàn giao.',
          resolutionGuidance:
            'Tiếp tục cân nhắc nếu người gọi thừa nhận chưa có tiền thuê trước bàn giao và đưa khoảng chờ này vào mô hình, không hứa bàn giao sớm.',
        },
      ],
      openingLine: 'Alo, anh Đức đây em.',
      hangUpGuidance:
        'Kết thúc cuộc gọi nếu người gọi liên tục khẳng định lợi suất được bảo đảm mà không giải thích giả định.',
      behaviorRules: [
        ...commonRules,
        'Nhớ bảng tính đã nhận nhưng không tự biết các khoản chi chưa được tư vấn.',
        'Chấp nhận chưa có số liệu chính xác nếu người gọi ghi nhận cần kiểm chứng trong buổi rà soát.',
      ],
      successCriteria: [
        'Anh đồng ý buổi rà soát dòng tiền vào ngày giờ cụ thể.',
        'Hai bên thống nhất bảng rà soát phải có chi phí, trống phòng và thời gian chờ bàn giao.',
      ],
    },
  },
  {
    slug: 'warm-call-family-decision-meeting',
    type: 'warm_call',
    offering: 'the-paris-2br',
    title: 'Gọi lại sau khi xem nhà - Chị Thảo',
    description:
      'Gọi lại khách đã xem nhà mẫu, cập nhật việc cân nhắc và thống nhất thành phần buổi tư vấn tiếp theo.',
    difficulty: 'intermediate',
    minutes: 7,
    tags: ['warm_call', 'own_use', 'family_buyer'],
    brief: {
      background:
        'Bạn đã dẫn chị Thảo xem căn 2PN The Paris - Vinhomes Ocean Park cuối tuần trước. Chị xin mang tài liệu về trao đổi với gia đình và đồng ý để bạn gọi lại hôm nay.',
      previousInteractions: [
        {
          when: 'Thứ Bảy tuần trước',
          channel: 'showroom',
          summary:
            'Chị Thảo xem căn hướng hồ, hỏi về diện tích và giá 3,9 tỷ, nhận bảng giá cùng tiến độ thanh toán để về trao đổi với gia đình.',
          agreedNextStep: 'Gọi lại giữa tuần để thống nhất bước tiếp theo.',
        },
      ],
      objective:
        'Hẹn được buổi tư vấn tiếp theo có những người cùng quyết định tham dự vào ngày giờ cụ thể.',
    },
    config: {
      kind: 'warm_call',
      buyer: {
        name: 'Thảo',
        addressTerm: 'chị',
        gender: 'female',
        age: 31,
        occupation: 'Chuyên viên nhân sự',
        familySituation: 'Sắp kết hôn, hiện sống cùng bố mẹ',
        motivation: {
          type: 'own_use',
          detail: 'Tìm căn hộ cho hai vợ chồng sau khi kết hôn.',
        },
        budget: {
          max: 4_100_000_000,
          currency: 'VND',
          fundingSource: 'Tiết kiệm của hai người và hỗ trợ từ bố mẹ',
        },
        priorities: ['Không gian phù hợp', 'Pháp lý minh bạch', 'Kế hoạch vốn'],
        decisionMaker: {
          role: 'family_decision',
          detail: 'Chị, chồng sắp cưới và bố mẹ cùng cân nhắc.',
        },
        urgency: {
          level: 'medium',
          timeline: 'Có thể thuê tạm đến khi dự án bàn giao',
        },
        emotionalState: 'neutral',
        communicationStyle: ['Lịch sự', 'Không muốn làm gia đình mất lòng'],
      },
      learnerKnows: [],
      privateBackground:
        'Thích căn hộ nhưng chưa thể tự chốt lịch hoặc tài chính mà không trao đổi với người nhà.',
      recollection:
        'Nhớ được dẫn xem căn 2PN, đã nhận tài liệu và nói sẽ hỏi ý kiến gia đình.',
      sinceLastContact:
        'Bố chị yêu cầu được xem hồ sơ pháp lý trước khi xác nhận khoản hỗ trợ; chồng sắp cưới muốn cùng nghe tư vấn nhưng chỉ rảnh cuối tuần.',
      hiddenInsights: [
        {
          key: 'parent_funding_condition',
          insight:
            'Bố dự kiến hỗ trợ 1,2 tỷ, nhưng khoản này chưa được xác nhận cho đến khi ông trực tiếp xem hồ sơ pháp lý; thiếu khoản hỗ trợ thì kế hoạch vốn không đủ.',
          revealGuidance:
            'Nói khi được hỏi ai tham gia quyết định và nguồn vốn.',
          relatesTo: 'budget.fundingSource',
        },
        {
          key: 'fiance_schedule',
          insight:
            'Chồng sắp cưới muốn cùng nghe tư vấn, chỉ rảnh chiều thứ Bảy; chị không muốn buổi gặp thiếu anh rồi phải giải thích lại.',
          revealGuidance:
            'Nói khi người gọi hỏi ai cần tham dự và lịch phù hợp.',
          relatesTo: 'decisionMaker',
        },
      ],
      objections: [
        {
          key: 'family_not_ready',
          category: 'decision_authority',
          sampleWording: 'Chị chưa quyết được, phải hỏi thêm người nhà.',
          raiseGuidance:
            'Nêu khi người gọi hỏi việc cân nhắc sau buổi xem nhà.',
          resolutionGuidance:
            'Chia sẻ vai trò từng người nếu được hỏi tôn trọng; đồng ý buổi tư vấn chung thay vì bị yêu cầu quyết thay gia đình.',
        },
        {
          key: 'documents_before_meeting',
          category: 'trust',
          sampleWording:
            'Bố chị muốn xem giấy tờ trước, đi xem nhà nữa chưa giải quyết được.',
          raiseGuidance:
            'Nêu khi người gọi đề nghị một buổi xem nhà giống lần trước.',
          resolutionGuidance:
            'Đồng ý hẹn nếu người gọi đề xuất gửi tài liệu hiện có trước và chuẩn bị buổi giải thích pháp lý; không nói dự án đã có sổ hồng.',
        },
      ],
      openingLine: 'Alo, chị Thảo nghe đây em.',
      hangUpGuidance:
        'Kết thúc lịch sự nếu người gọi gây áp lực để chị quyết mà bỏ qua người cùng góp tiền.',
      behaviorRules: [
        ...commonRules,
        'Không tự kể vai trò tài chính của bố ngay đầu cuộc gọi.',
        'Chỉ đồng ý lịch chung khi có kế hoạch mời bố và chồng sắp cưới, đồng thời xác nhận lịch của họ.',
      ],
      successCriteria: [
        'Chị đồng ý ngày giờ cụ thể cho buổi tư vấn có bố và chồng sắp cưới, kèm cách xác nhận lịch với họ.',
        'Hai bên thống nhất gửi tài liệu pháp lý hiện có trước buổi tư vấn.',
      ],
    },
  },
  {
    slug: 'cold-call-studio-first-investment',
    type: 'cold_call',
    offering: 'the-paris-studio',
    title: 'Gọi lần đầu - Anh Quân',
    description:
      'Gọi cho khách trẻ hỏi giá studio qua Zalo, làm rõ mục đích mua và hẹn buổi tính khoản vay.',
    difficulty: 'intermediate',
    minutes: 5,
    tags: ['cold_call', 'investment', 'first_time_buyer'],
    brief: {
      background:
        'Anh Quân nhắn Zalo OA của dự án hỏi giá căn studio The Paris - Vinhomes Ocean Park chiều qua. Đây là lần đầu bạn gọi cho anh.',
      leadSource: 'Tin nhắn hỏi giá qua Zalo OA của dự án',
      objective:
        'Làm rõ anh Quân mua để ở hay để cho thuê, và hẹn được buổi tính khoản vay vào ngày giờ cụ thể.',
    },
    config: {
      kind: 'cold_call',
      buyer: {
        name: 'Quân',
        addressTerm: 'anh',
        gender: 'male',
        age: 27,
        occupation: 'Nhân viên kinh doanh ô tô',
        familySituation:
          'Chưa kết hôn, đang có bạn gái, thuê phòng ở Long Biên',
        motivation: {
          type: 'mixed',
          detail:
            'Muốn có tài sản đầu tiên, trước mắt cho thuê, sau này có thể về ở.',
        },
        budget: {
          max: 2_200_000_000,
          currency: 'VND',
          fundingSource:
            'Tiết kiệm 700 triệu, bố mẹ hỗ trợ 300 triệu, phần còn lại vay ngân hàng',
        },
        priorities: [
          'Tổng tiền vừa sức',
          'Cho thuê được để bù tiền trả góp',
          'Thanh khoản khi muốn bán lại',
        ],
        decisionMaker: {
          role: 'sole_decision_maker',
          detail: 'Tự quyết nhưng sẽ hỏi ý bố mẹ vì có khoản hỗ trợ.',
        },
        urgency: {
          level: 'medium',
          timeline: 'Trong năm nay nếu tính được khoản vay',
        },
        emotionalState: 'friendly',
        communicationStyle: ['Nói nhanh', 'Hỏi thẳng về giá và lãi suất'],
      },
      learnerKnows: ['age', 'occupation'],
      privateBackground:
        'Anh làm sales nên quen bị chào hàng; thích người tư vấn hỏi đúng nhu cầu hơn là đọc bảng giá.',
      recollection:
        'Chiều qua nhắn Zalo hỏi giá studio sau khi xem video giới thiệu dự án, chưa nhận được bảng giá.',
      hiddenInsights: [
        {
          key: 'parents_condition',
          insight:
            'Bố mẹ chỉ hỗ trợ 300 triệu nếu sau khi cưới, khoảng 2 năm nữa, anh dọn về ở căn này, không phải chỉ để cho thuê.',
          revealGuidance:
            'Nói khi được hỏi về nguồn tiền hoặc ai cùng góp ý quyết định.',
          relatesTo: 'budget.fundingSource',
        },
        {
          key: 'commission_income',
          insight:
            'Thu nhập chủ yếu từ hoa hồng; tháng thấp chỉ khoảng 15 triệu, nên anh lo khoản trả góp khi hết 24 tháng hỗ trợ.',
          revealGuidance:
            'Nói khi được hỏi về thu nhập ổn định hoặc mức trả góp mỗi tháng.',
          relatesTo: 'budget',
        },
      ],
      objections: [
        {
          key: 'just_send_price',
          category: 'brush_off',
          sampleWording: 'Em gửi bảng giá qua Zalo là được, anh tự xem.',
          underlyingReason: 'Nghĩ cuộc gọi sẽ chỉ là đọc bảng giá.',
          raiseGuidance: 'Nêu ngay sau khi người gọi giới thiệu.',
          resolutionGuidance:
            'Đồng ý nói chuyện tiếp nếu người gọi hỏi ngắn gọn anh mua để ở hay cho thuê, thay vì đọc giá.',
        },
        {
          key: 'too_small',
          category: 'product',
          sampleWording:
            'Hai mươi chín mét vuông, sau này lấy vợ thì ở sao được em?',
          underlyingReason: 'Điều kiện hỗ trợ của bố mẹ.',
          raiseGuidance:
            'Nêu khi người gọi nói về diện tích hoặc khi được hỏi về kế hoạch ở.',
          resolutionGuidance:
            'Cân nhắc tiếp nếu người gọi thừa nhận studio không hợp ở lâu dài cho gia đình và cùng anh làm rõ mục tiêu trước mắt, không khẳng định studio đủ cho hai vợ chồng.',
        },
      ],
      openingLine: 'Alo, Quân nghe.',
      hangUpGuidance:
        'Kết thúc lịch sự nếu người gọi đọc bảng giá liên tục mà không hỏi anh cần gì.',
      behaviorRules: [
        ...commonRules,
        'Không tin ngay lời quảng cáo "lãi suất 0%"; hỏi lại sau đó trả bao nhiêu.',
      ],
      successCriteria: [
        'Người gọi làm rõ anh mua để ở, để cho thuê hay cả hai.',
        'Anh đồng ý một ngày giờ cụ thể để cùng tính khoản vay.',
      ],
    },
  },
  {
    slug: 'warm-call-young-couple-expecting',
    type: 'warm_call',
    offering: 'the-paris-1br-plus',
    title: 'Gọi lại sau khi gửi bảng giá - Chị Ngọc',
    description:
      'Gọi lại cặp vợ chồng trẻ đã nhận bảng giá căn 1PN+1, tìm hiểu điều họ còn băn khoăn và hẹn cả hai xem nhà mẫu.',
    difficulty: 'beginner',
    minutes: 7,
    tags: ['warm_call', 'own_use', 'spouse_decision'],
    brief: {
      background:
        'Chị Ngọc hỏi về căn 1PN+1 The Paris - Vinhomes Ocean Park tuần trước. Bạn đã gửi bảng giá và tiến độ thanh toán, hôm nay gọi lại như đã hẹn.',
      previousInteractions: [
        {
          when: 'Thứ Ba tuần trước',
          channel: 'phone',
          summary:
            'Chị Ngọc hỏi căn có phòng phụ làm phòng cho em bé không và thanh toán trước bao nhiêu.',
          agreedNextStep:
            'Gửi bảng giá, tiến độ thanh toán và gọi lại sau khi chị bàn với chồng.',
        },
        {
          when: 'Tối thứ Ba tuần trước',
          channel: 'zalo',
          summary:
            'Bạn gửi bảng giá căn 1PN+1 khoảng 3,1 tỷ và tiến độ thanh toán; chị Ngọc đã xem.',
        },
      ],
      objective:
        'Tìm ra băn khoăn còn lại của hai vợ chồng và hẹn cả hai đến xem nhà mẫu vào ngày giờ cụ thể.',
    },
    config: {
      kind: 'warm_call',
      buyer: {
        name: 'Ngọc',
        addressTerm: 'chị',
        gender: 'female',
        age: 29,
        occupation: 'Nhân viên marketing',
        familySituation:
          'Kết hôn được một năm, hai vợ chồng đang thuê căn hộ nhỏ ở Long Biên',
        motivation: {
          type: 'own_use',
          detail: 'Mua căn hộ đầu tiên, có thêm phòng nhỏ cho em bé.',
        },
        budget: {
          max: 3_300_000_000,
          currency: 'VND',
          fundingSource: 'Tiết kiệm chung 1 tỷ, phần còn lại vay ngân hàng',
        },
        priorities: [
          'Có phòng cho em bé',
          'Khoản trả góp vừa sức',
          'Chồng đi làm không quá xa',
        ],
        decisionMaker: {
          role: 'joint_with_spouse',
          detail: 'Hai vợ chồng cùng quyết định.',
        },
        urgency: {
          level: 'medium',
          timeline: 'Trong vài tháng tới',
        },
        emotionalState: 'friendly',
        communicationStyle: ['Cởi mở', 'Hay hỏi lại cho chắc'],
      },
      learnerKnows: ['age', 'occupation', 'motivation'],
      privateBackground:
        'Chị thích căn hộ và tiện ích nội khu, nhưng chồng chị chưa xem trực tiếp nên còn lưỡng lự.',
      recollection:
        'Nhớ người gọi tư vấn nhiệt tình, đã nhận bảng giá và tiến độ thanh toán qua Zalo.',
      sinceLastContact:
        'Hai vợ chồng đã thử tính khoản trả góp và lo khi hết 24 tháng hỗ trợ lãi suất; chồng chị cũng ngại quãng đường đi làm.',
      hiddenInsights: [
        {
          key: 'baby_due',
          insight:
            'Chị đang mang thai tháng thứ năm, dự sinh tháng 2/2027; muốn ổn định chỗ ở trước khi con được 6 tháng nên rất quan tâm mốc bàn giao.',
          revealGuidance:
            'Nói khi được hỏi lúc nào gia đình muốn chuyển về hoặc vì sao cần phòng cho em bé.',
          relatesTo: 'urgency',
        },
        {
          key: 'husband_commute',
          insight:
            'Chồng chị làm ở Cầu Giấy; anh chỉ đồng ý nếu đi làm giờ cao điểm dưới khoảng 45 phút.',
          revealGuidance: 'Nói khi được hỏi chồng chị băn khoăn điều gì.',
          relatesTo: 'decisionMaker',
        },
      ],
      objections: [
        {
          key: 'payment_after_support',
          category: 'price',
          sampleWording:
            'Hết 24 tháng hỗ trợ thì mỗi tháng nhà chị phải trả bao nhiêu em?',
          raiseGuidance:
            'Nêu khi người gọi hỏi chị đã xem bảng giá và tiến độ chưa.',
          resolutionGuidance:
            'Yên tâm hơn nếu người gọi đưa con số ước tính kèm giả định lãi suất, hoặc đề nghị cùng tính cụ thể; không hứa lãi suất sau ưu đãi.',
        },
        {
          key: 'commute_too_far',
          category: 'product',
          sampleWording:
            'Chồng chị làm Cầu Giấy, sang Gia Lâm có xa quá không?',
          raiseGuidance:
            'Nêu sau khi khoản trả góp đã được trao đổi, hoặc khi người gọi mời đi xem nhà.',
          resolutionGuidance:
            'Đồng ý hẹn nếu người gọi hỏi rõ chỗ làm của anh và đề nghị cách kiểm chứng thực tế, ví dụ đi thử vào giờ cao điểm; không nói quá về thời gian di chuyển.',
        },
      ],
      openingLine: 'Alo, chị Ngọc nghe em ơi.',
      behaviorRules: [
        ...commonRules,
        'Thân thiện, sẵn sàng chia sẻ khi được hỏi đúng chủ đề.',
        'Chỉ đồng ý lịch xem nhà khi lịch đó có cả chồng chị.',
      ],
      successCriteria: [
        'Người gọi phát hiện chồng chị lo quãng đường đi làm.',
        'Hẹn được cả hai vợ chồng xem nhà mẫu vào ngày giờ cụ thể.',
      ],
    },
  },
  {
    slug: 'warm-call-three-generation-family',
    type: 'warm_call',
    offering: 'the-paris-3br',
    title: 'Gọi lại sau khi xem nhà - Cô Hạnh',
    description:
      'Gọi lại khách lớn tuổi mua căn 3PN cho gia đình ba thế hệ; xử lý băn khoăn về sống chung và nguồn tiền từ bán nhà cũ.',
    difficulty: 'advanced',
    minutes: 8,
    tags: ['warm_call', 'own_use', 'family_buyer'],
    brief: {
      background:
        'Cô Hạnh cùng con trai đã xem nhà mẫu căn 3PN góc The Paris - Vinhomes Ocean Park cuối tuần trước. Cô hẹn bạn gọi lại sau khi bàn với gia đình.',
      previousInteractions: [
        {
          when: 'Chủ nhật tuần trước',
          channel: 'showroom',
          summary:
            'Cô Hạnh và con trai xem căn 3PN góc tầng 20, hỏi nhiều về Vinmec, thang máy và tiến độ thanh toán.',
          agreedNextStep: 'Gọi lại giữa tuần sau khi cô bàn với gia đình.',
        },
      ],
      objective:
        'Hẹn được buổi gặp có cô Hạnh, con trai và con dâu để xem lại mặt bằng căn hộ và kế hoạch thanh toán.',
    },
    config: {
      kind: 'warm_call',
      buyer: {
        name: 'Hạnh',
        addressTerm: 'cô',
        gender: 'female',
        age: 56,
        occupation: 'Kế toán đã nghỉ hưu',
        familySituation:
          'Sống cùng vợ chồng con trai và hai cháu nội trong nhà ống ở Long Biên',
        motivation: {
          type: 'own_use',
          detail:
            'Đổi nhà ống chật sang căn hộ rộng hơn cho cả gia đình ba thế hệ.',
        },
        budget: {
          max: 5_800_000_000,
          currency: 'VND',
          fundingSource:
            'Bán nhà ống ở Long Biên và con trai góp thêm khoảng 1,3 tỷ',
        },
        priorities: [
          'Đủ chỗ cho cả gia đình',
          'Gần bệnh viện và trường học cho cháu',
          'Không phải vay nhiều',
        ],
        decisionMaker: {
          role: 'family_decision',
          detail: 'Cô, con trai và con dâu cùng quyết định.',
        },
        urgency: {
          level: 'medium',
          timeline: 'Trong năm tới',
        },
        emotionalState: 'neutral',
        communicationStyle: ['Nói chậm', 'Cẩn thận về tiền bạc'],
      },
      learnerKnows: ['age', 'familySituation', 'motivation'],
      privateBackground:
        'Cô rất thích căn góc vì thoáng và gần Vinmec, nhưng không muốn quyết định thay các con.',
      recollection:
        'Nhớ người gọi dẫn xem nhà mẫu chu đáo, con trai cô thích căn góc tầng cao.',
      sinceLastContact:
        'Con dâu cô ngại ở chung vì muốn có không gian riêng; nhà ống ở Long Biên có người hỏi mua nhưng trả giá thấp.',
      hiddenInsights: [
        {
          key: 'daughter_in_law_privacy',
          insight:
            'Con dâu chỉ đồng ý ở chung nếu vợ chồng con có phòng và phòng tắm riêng, tách khỏi phòng của cô.',
          revealGuidance:
            'Nói khi người gọi hỏi nhẹ nhàng mong muốn của từng người trong nhà.',
          relatesTo: 'decisionMaker',
        },
        {
          key: 'house_sale_timing',
          insight:
            'Nhà cũ chưa bán được; bán gấp sẽ mất giá nên cô cần lịch thanh toán khớp với thời gian bán nhà.',
          revealGuidance:
            'Nói khi được hỏi về nguồn tiền hoặc thời điểm có thể thanh toán.',
          relatesTo: 'budget.fundingSource',
        },
      ],
      objections: [
        {
          key: 'living_together',
          category: 'decision_authority',
          sampleWording: 'Con dâu cô chưa muốn ở chung, cô chưa quyết được.',
          raiseGuidance: 'Nêu sớm, khi người gọi hỏi gia đình đã bàn thế nào.',
          resolutionGuidance:
            'Đồng ý hẹn gặp cả nhà nếu người gọi hỏi tôn trọng về nhu cầu riêng của từng người và đề xuất cùng xem cách bố trí phòng; không ép cô quyết thay.',
        },
        {
          key: 'sell_house_first',
          category: 'timing',
          sampleWording:
            'Cô phải bán được nhà cũ đã, chưa có tiền thì cọc sao được.',
          raiseGuidance:
            'Nêu khi người gọi nói đến đặt cọc hoặc thời điểm thanh toán.',
          resolutionGuidance:
            'Tiếp tục cân nhắc nếu người gọi giải thích tiến độ thanh toán chia nhỏ trước bàn giao và đề nghị lập kế hoạch theo thời gian bán nhà; không hứa ngân hàng chắc chắn cho vay.',
        },
      ],
      openingLine: 'Alo, cô Hạnh nghe đây cháu.',
      hangUpGuidance:
        'Kết thúc lịch sự nếu người gọi ép đặt cọc trước khi cô bán được nhà hoặc nói xấu con dâu cô.',
      behaviorRules: [
        ...commonRules,
        'Nói chậm, hỏi lại các con số để chắc chắn.',
        'Không tự kể chuyện con dâu ngại ở chung cho đến khi được hỏi khéo về gia đình.',
      ],
      successCriteria: [
        'Người gọi phát hiện con dâu cần không gian riêng.',
        'Hẹn được buổi gặp có cô, con trai và con dâu vào ngày giờ cụ thể.',
      ],
    },
  },
  {
    slug: 'cold-call-luxury-payment-options',
    type: 'cold_call',
    offering: 'essence-peak-2br',
    title: 'Gọi lần đầu - Anh Long',
    description:
      'Gọi cho chủ doanh nghiệp quan tâm căn hộ hạng sang, xử lý nghi ngờ về chiết khấu và hẹn buổi so sánh phương án thanh toán.',
    difficulty: 'intermediate',
    minutes: 5,
    tags: ['cold_call', 'mixed', 'premium'],
    brief: {
      background:
        'Anh Long để lại danh thiếp tại sự kiện giới thiệu Lumière Essence Peak - Vinhomes Global Gate tuần trước. Đây là lần đầu bạn gọi cho anh.',
      leadSource: 'Danh thiếp để lại tại sự kiện giới thiệu dự án',
      objective:
        'Hẹn được buổi so sánh các phương án thanh toán và tham quan nhà mẫu vào ngày giờ cụ thể.',
    },
    config: {
      kind: 'cold_call',
      buyer: {
        name: 'Long',
        addressTerm: 'anh',
        gender: 'male',
        age: 42,
        occupation: 'Chủ doanh nghiệp logistics ở Đông Anh',
        familySituation: 'Đã có vợ và hai con, đang ở nhà phố tại Đông Anh',
        motivation: {
          type: 'mixed',
          detail:
            'Muốn chuyển gia đình lên căn hộ cao cấp gần hồ, sau này có thể cho thuê lại.',
        },
        budget: {
          max: 10_000_000_000,
          currency: 'VND',
          fundingSource: 'Tiền từ kinh doanh, có thể vay thêm nếu cần',
        },
        priorities: [
          'Chất lượng hoàn thiện',
          'Không gian sống yên tĩnh gần hồ',
          'Giá hợp lý so với giá trị',
        ],
        decisionMaker: {
          role: 'joint_with_spouse',
          detail: 'Vợ anh có tiếng nói lớn về căn hộ để ở.',
        },
        urgency: {
          level: 'low',
          timeline: 'Không vội, chờ phương án tốt',
        },
        emotionalState: 'guarded',
        communicationStyle: ['Ít lời', 'Hỏi thẳng về con số'],
      },
      learnerKnows: ['occupation'],
      privateBackground:
        'Anh đi sự kiện vì vợ quan tâm, bản thân còn nghi giá căn hộ hạng sang bị đẩy lên quá cao.',
      recollection:
        'Nhớ có đi sự kiện giới thiệu dự án và để lại danh thiếp, không nhớ tên nhân viên.',
      hiddenInsights: [
        {
          key: 'cash_tied_up',
          insight:
            'Tiền đang quay vòng kinh doanh; năm nay anh chỉ rút được khoảng một nửa, phần còn lại sau Tết, nên khó theo phương án thanh toán sớm.',
          revealGuidance:
            'Nói khi được hỏi anh muốn thanh toán thế nào hoặc tiền có sẵn lúc nào.',
          relatesTo: 'budget.fundingSource',
        },
        {
          key: 'wife_wants_lake_view',
          insight:
            'Vợ anh chỉ thích căn nhìn thẳng ra hồ và chấp nhận trả thêm cho view đó.',
          revealGuidance:
            'Nói khi được hỏi ai cùng quyết định hoặc vợ anh thích điều gì ở dự án.',
          relatesTo: 'decisionMaker',
        },
      ],
      objections: [
        {
          key: 'price_per_m2',
          category: 'price',
          sampleWording:
            'Gần 140 triệu một mét vuông ở Đông Anh, ngang nội đô rồi em.',
          raiseGuidance: 'Nêu khi người gọi nói đến giá.',
          resolutionGuidance:
            'Nghe tiếp nếu người gọi thừa nhận giá cao và giải thích giá trị cụ thể (vị trí cạnh hồ, tiêu chuẩn hoàn thiện), không so sánh hạ thấp dự án khác.',
        },
        {
          key: 'discount_suspicion',
          category: 'trust',
          sampleWording:
            'Chiết khấu 17% thì chắc giá niêm yết đã đội lên rồi chứ gì.',
          underlyingReason: 'Từng gặp dự án nâng giá rồi chiết khấu.',
          raiseGuidance: 'Nêu khi người gọi nhắc đến chiết khấu.',
          resolutionGuidance:
            'Yên tâm hơn nếu người gọi giải thích chiết khấu là đổi lấy thanh toán sớm, nêu rõ phương án trả theo tiến độ chiết khấu thấp hơn và đề nghị so sánh tổng tiền của từng phương án.',
        },
      ],
      openingLine: 'Alo, ai đấy?',
      hangUpGuidance:
        'Cúp máy nếu người gọi nói chung chung về "đẳng cấp" mà không trả lời câu hỏi về con số.',
      behaviorRules: [
        ...commonRules,
        'Trả lời ngắn lúc đầu; cởi mở hơn khi người gọi đưa ra con số rõ ràng.',
      ],
      successCriteria: [
        'Người gọi làm rõ được anh muốn thanh toán theo cách nào.',
        'Hẹn được buổi so sánh phương án thanh toán và tham quan nhà mẫu, có mời vợ anh.',
      ],
    },
  },
]

async function main() {
  const competencyIds = new Map<string, string>()
  for (const item of COMPETENCY_CATALOGUE) {
    const rubric = Object.values(SCORECARD_TEMPLATES)
      .flat()
      .find(
        (criterion) => criterion.competencyCode === item.code,
      )!.defaultRubric
    const [row] = await db
      .insert(competencies)
      .values({
        code: item.code,
        name: item.name,
        description: rubric.description,
      })
      .onConflictDoUpdate({
        target: competencies.code,
        set: { name: item.name },
      })
      .returning({ id: competencies.id })
    competencyIds.set(item.code, row.id)
  }

  const offeringIds = new Map<string, string>()
  for (const item of offerings) {
    salesOfferingSchema.parse(item.offering)
    const existing = await db.query.salesOfferings.findFirst({
      where: and(
        eq(salesOfferings.name, item.name),
        isNull(salesOfferings.workspaceId),
      ),
    })
    // Like global practices, global offerings are owned by this file. Edits
    // that change the facts belong under a new name, so the practices using the
    // old offering can be moved on deliberately.
    const offering = JSON.parse(
      JSON.stringify(item.offering),
    ) as SalesOfferingConfig
    if (existing) {
      const changed = !isDeepStrictEqual(existing.offering, offering)
      await db
        .update(salesOfferings)
        .set(
          changed
            ? { isGlobal: true, offering, updatedAt: new Date() }
            : { isGlobal: true },
        )
        .where(eq(salesOfferings.id, existing.id))
      if (changed) console.log(`Updated offering ${item.name}`)
    }
    const id =
      existing?.id ??
      (
        await db
          .insert(salesOfferings)
          .values({ name: item.name, offering: item.offering, isGlobal: true })
          .returning({ id: salesOfferings.id })
      )[0].id
    offeringIds.set(item.key, id)
  }

  for (const item of seeds) {
    const existing = await db.query.practices.findFirst({
      where: eq(practices.slug, item.slug),
    })
    if (existing) {
      if (existing.workspaceId || existing.createdByUserId)
        throw new Error(`Seed slug belongs to a private practice: ${item.slug}`)
      await db
        .update(practices)
        .set({ isGlobal: true })
        .where(eq(practices.id, existing.id))
      // Global practices cannot be edited in the app, so this file is the source
      // of truth for their buyer behavior; push config edits to existing rows.
      // The offering and learner brief must move with the config, or the buyer's
      // budget would no longer match the product the learner is pitching.
      learnerBriefSchema.parse(item.brief)
      const brief = JSON.parse(JSON.stringify(item.brief)) as LearnerBrief
      const salesOfferingId = offeringIds.get(item.offering)!
      if (
        existing.salesOfferingId !== salesOfferingId ||
        existing.title !== item.title ||
        existing.description !== item.description ||
        !isDeepStrictEqual(existing.learnerBrief, brief)
      ) {
        await db
          .update(practices)
          .set({
            salesOfferingId,
            title: item.title,
            description: item.description,
            learnerBrief: brief,
            updatedAt: new Date(),
          })
          .where(eq(practices.id, existing.id))
        console.log(`Updated offering and brief for ${item.slug}`)
      }
      agentConfigSchema.parse(item.config)
      // Compare in stored form: JSON drops undefined fields.
      const config = JSON.parse(
        JSON.stringify(item.config),
      ) as PracticeAgentConfig
      const current = await db.query.practiceAgentConfigs.findFirst({
        where: eq(practiceAgentConfigs.practiceId, existing.id),
      })
      if (current && !isDeepStrictEqual(current.config, config)) {
        await db
          .update(practiceAgentConfigs)
          .set({ config, updatedAt: new Date() })
          .where(eq(practiceAgentConfigs.practiceId, existing.id))
        console.log(`Updated agent config for ${item.slug}`)
      }
      if (existing.status === 'draft') await publishPractice(existing.id)
      continue
    }
    learnerBriefSchema.parse(item.brief)
    agentConfigSchema.parse(item.config)
    // Templates contain explicit 0/40/70/90/100 behavior anchors and numeric
    // critical-error caps. This is editable starter policy, not calibrated.
    const scorecard = SCORECARD_TEMPLATES[item.type].map((criterion) => ({
      ...criterion,
      rubric: rubricSchema.parse(criterion.defaultRubric),
    }))
    const practiceId = await db.transaction(async (tx) => {
      const [practice] = await tx
        .insert(practices)
        .values({
          slug: item.slug,
          isGlobal: true,
          type: item.type,
          title: item.title,
          description: item.description,
          difficulty: item.difficulty,
          estimatedMinutes: item.minutes,
          tags: item.tags,
          learnerBrief: item.brief,
          salesOfferingId: offeringIds.get(item.offering)!,
          status: 'draft',
        })
        .returning({ id: practices.id })
      await tx.insert(practiceAgentConfigs).values({
        practiceId: practice.id,
        config: item.config,
      })
      for (const criterion of scorecard) {
        await tx.insert(practiceCompetencies).values({
          practiceId: practice.id,
          competencyId: competencyIds.get(criterion.competencyCode)!,
          weight: criterion.weight,
          rubric: criterion.rubric,
        })
      }
      return practice.id
    })
    await publishPractice(practiceId)
    console.log(`Seeded ${item.slug}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$client.end())
