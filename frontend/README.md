SalesCoach AI Frontend React App

## ⚡ Quick Start

**1) Cài đặt & chạy**

```bash
npm i -g pnpm
cp .env.example .env
pnpm install
pnpm dev
```

**2) Database**

- Có thể dùng [Neon Postgres](https://neon.com/) free tier hoặc self-hosted PostgreSQL
- Dự án dùng Drizzle ORM. Schema được định nghĩa trong `src/db/schema.ts`.
- Sau khi cấu hình `DATABASE_URL` trong `.env`, chạy lệnh sau để đồng bộ schema với PostgreSQL. Chạy lệnh khi thiết lập cơ sở dữ liệu lần đầu và sau khi thay đổi `src/db/schema.ts`. Không cần chạy mỗi lần khởi động ứng dụng:

  ```bash
  pnpm db:push
  ```

  Credit balances use `0 <= reserved_seconds <= remaining_seconds <= total_seconds`: reserved minutes are held within the unconsumed balance, not added to it. Reservation changes only `reserved_seconds`; settlement deducts actual usage from `remaining_seconds` and releases the hold. Existing databases with the old `credit_grants_balance_valid` constraint must replace it with this invariant when applying the schema update; no balance reset is required.

- Sau khi đồng bộ schema, chạy lệnh sau trong thư mục `frontend/` để seed dữ liệu bài luyện tập. Chỉ cần chạy khi thiết lập cơ sở dữ liệu lần đầu, không cần chạy mỗi lần khởi động ứng dụng:

  ```bash
  pnpm db:seed-practices
  ```

### Theme và design tokens

`src/styles.css` là nguồn chung cho màu và font: primary charcoal `#202423`, secondary xanh nhạt `#D9EDF3`, brand/link teal `#286572`, background `#FAFBFA`, muted text `#626C70` và border `#E1E6E5`. Font mặc định là Be Vietnam Pro; `font-numeric` giữ Manrope cho số bước trên trang chủ. Gradient thương hiệu, bài gợi ý và CTA cuối có token riêng; không áp gradient cho toàn bộ body.

Trang chủ, năm màn hình auth, thư viện và phiên luyện tập, tài khoản, billing, navigation và modal thêm workspace dùng utility semantic thay vì mã hex. Hover riêng được giữ bằng `primary-hover`, `primary-hover-strong`, `secondary-hover`, `secondary-hover-soft` và `muted-hover`; link dùng `text-brand`, không dùng màu primary. `.dark` có giá trị tương ứng cho tokens, không thêm bộ chọn theme. Những trang chưa chuyển thiết kế vẫn giữ màu/font riêng hiện có; component dùng semantic tokens nhận theme mới.

### Trang chủ (`/`)

Trang chủ theo thiết kế Pencil desktop/mobile: nền gradient, font Be Vietnam Pro, minh họa cuộc gọi, tình huống cold/warm call, phản hồi và nội dung cho đội ngũ. Bảng giá dùng bảng so sánh trên desktop và thẻ đầy đủ quyền lợi trên mobile. Bộ chọn tháng/năm giữ giá và `interval` checkout đồng bộ; khách chưa đăng nhập được chuyển qua `/login` với `callbackUrl` về billing. CTA luyện tập dẫn đến `/practice`; menu tài khoản giữ hồ sơ, gói/hạn mức và đăng xuất.

Điều hướng giữ đủ bốn mục: Sản phẩm, Cách hoạt động, Dành cho đội ngũ và Bảng giá. Header hiển thị đầy đủ từ 1280px; dưới 1280px dùng menu toàn màn hình theo thiết kế Pencil, có header gradient, nút đóng 44px, các hàng liên kết có đường phân cách và CTA phía dưới. Menu cuộn trên màn hình thấp; chọn liên kết hoặc nhấn Escape sẽ đóng menu, nút đóng trả focus về hamburger. Khách chưa đăng nhập có thêm CTA Đăng nhập. Bảng giá có trong cả header, menu và footer.

Dropdown tài khoản trên trang chủ dùng font Be Vietnam Pro, avatar xanh nhạt 44px, panel 260px giới hạn theo viewport, hai hàng hồ sơ/gói cao 44px và mục đăng xuất màu đỏ theo thiết kế Pencil. Tên/email dài được rút gọn; hành vi đăng xuất và thông báo lỗi giữ nguyên.

### Đăng nhập và khôi phục tài khoản

`/signup`, `/login`, `/forgot-password`, `/verify-email` và `/reset-password` dùng chung `src/components/auth/auth-layout.tsx` theo thiết kế Pencil: font Be Vietnam Pro, panel thương hiệu gradient bo góc, form tối đa 448px, input/CTA cao 52px và trạng thái disabled nền xám. Panel thương hiệu chỉ hiện từ 1280px; màn hình nhỏ dùng form một cột và cuộn khi cần. Signup hiển thị yêu cầu username; trường mã xác minh hỗ trợ bàn phím số. API, chuẩn hóa email, consent, remember-me, OTP, token reset và redirect an toàn giữ nguyên.

### Thư viện luyện tập (`/practice`)

Trang thư viện theo frame Pencil: font Be Vietnam Pro, nền trung tính, thẻ gợi ý gradient xanh–vàng, bộ lọc sáu cột trên desktop và thẻ bài luyện hai cột; mobile xếp nội dung một cột. Nội dung, số bài, gợi ý và quyền xóa vẫn lấy từ dữ liệu workspace, không cố định theo dữ liệu mẫu trong thiết kế. Nút “Xem bài luyện” giữ luồng tạo phiên và mở trang chuẩn bị; hướng dẫn và xác nhận xóa dùng ResponsiveModal.

Header mobile đặt nút “Tạo bài luyện” đầy chiều rộng cạnh nút hướng dẫn dạng icon 44px; desktop đặt hai hành động cạnh nhau. Lề mobile 20px, bộ lọc kỹ năng/độ khó chia hai cột và sản phẩm chiếm cả hàng. Nút lọc cao 44px trên mobile; dòng mô tả phụ của bài gợi ý chỉ hiện trên desktop.

Sidebar và menu tài khoản dùng cùng kiểu chữ, avatar xanh nhạt và workspace đang chọn có dấu kiểm. Giữ các liên kết hồ sơ/gói, workspace thực tế, chặn chuyển workspace khi có cuộc gọi đang mở, thêm workspace và đăng xuất. Panel giới hạn theo viewport; menu mobile giữ đóng bằng nút, Escape và chọn liên kết.

Modal thêm workspace dùng cùng font Be Vietnam Pro, nền trung tính, CTA đen và viền focus xanh; nhãn cách input 12px, input cao 48px. Desktop hiển thị dialog giữa màn hình; mobile dùng bottom sheet với nút đầy chiều rộng. Validation, request ID, tạo/chọn workspace và chuyển sang billing giữ nguyên.

### Tạo bài luyện (`/practice/create`)

Trang tạo bài theo frame Pencil desktop/mobile, dùng màu/font semantic từ `src/styles.css`: banner Excel nền `secondary`, trợ lý nền `warm`, biểu mẫu/preview nền trung tính và CTA `primary`. Từ 1280px, form và cột trợ lý/preview đặt cạnh nhau; màn hình nhỏ xếp form, preview, trợ lý và hướng dẫn thành một cột với lề 20px. Hành động lưu/tạo nằm cuối nội dung, đầy chiều rộng trên mobile, không che biểu mẫu bằng footer cố định.

Nhập Excel dùng ResponsiveModal: dialog 624px trên desktop, bottom sheet cuộn trên màn hình nhỏ, nút đóng 44px và các CTA 48–52px. Review mobile thay vùng chọn file bằng tên file, trạng thái đọc và nút chọn file khác; desktop giữ vùng chọn file. Nút áp dụng bị khóa khi chưa đọc file hoặc chưa đồng ý thay nội dung hiện có. Parsing cục bộ, giới hạn .xlsx/5 MB, draft tự lưu theo workspace/user, validation, focus lỗi, rubric và API lưu/xuất bản giữ nguyên; dữ liệu mẫu trong frame không được cố định vào UI.

### Phiên luyện tập (`/practice/session/$sessionId`)

Các trạng thái chuẩn bị, đang gọi và kết quả theo frame Pencil desktop/mobile: mục tiêu nền `warm`, khu vực gọi `brand-gradient`, avatar chữ nền `secondary`, CTA `primary` và bản ghi hội thoại dạng văn bản. Ba panel hiện cạnh nhau từ 1280px; màn hình nhỏ xếp một cột với lề 20px và tự thu gọn tình huống khi cuộc gọi bắt đầu. Sidebar/menu tài khoản dùng navigation chung. Hướng dẫn, xác nhận kết thúc và thiết bị âm thanh dùng ResponsiveModal.

Kết quả dùng summary nền `secondary`, điểm theo kỹ năng và thẻ phản hồi nền trung tính, điểm cần nhớ nền `warm`. Nội dung/điểm lấy từ phiên thực tế; giữ coverage, trạng thái chưa đánh giá, chờ/lỗi phản hồi và liên kết bằng chứng về lượt hội thoại. Không thay đổi API, lựa chọn TTS, quyền mic, lưu phiên hoặc tải transcript. Font/màu đều dùng token hiện có trong `src/styles.css`, bao gồm dark theme.

### Tài khoản và billing (`/account`, `/billing`)

Hai trang theo frame Pencil với font Be Vietnam Pro, tiêu đề normal-weight và màu semantic từ `src/styles.css`. Account giữ navigation chung, tab Hồ sơ/Gói & hạn mức đồng bộ search, hồ sơ chỉ đọc, thẻ gói gradient và hai số dư phút nền `secondary`/`warm`. Billing là trang độc lập có logo, summary gradient, thẻ checkout Personal/Business hai cột trên desktop và một cột trên mobile; lựa chọn phút mua thêm giữ hai cột, trạng thái chọn có `aria-pressed`.

Thông tin người dùng, workspace, giá, số phút, thời hạn và đơn hàng lấy từ dữ liệu thực tế, không từ mẫu thiết kế. Giữ quyền owner/member, cảnh báo ghế/gói hết hạn, refetch và lỗi dữ liệu cũ, tạo/chuyển workspace, gán ghế, payload checkout và hủy đơn/gói. Lịch sử đơn pending/expired/review dùng nền `warm`; đơn quay về từ checkout được đánh dấu riêng. Mobile dùng lề 20px và điều khiển vừa viewport; dark theme dùng token sẵn có.

### Trạng thái thanh toán

Trang `/billing` hiển thị trạng thái và lỗi xác minh SePay trong từng thẻ đơn hàng, kèm tên sản phẩm, mã đơn và số tiền. Đơn quay về từ checkout được đánh dấu riêng; thông báo đã thanh toán của đơn mua phút không áp dụng cho đơn đăng ký khác. API summary trả `verificationWarning` theo từng đơn; lỗi tải lại toàn bộ danh sách được hiển thị riêng và giữ trạng thái đã tải gần nhất. Các đơn đang chờ tiếp tục được kiểm tra mỗi 15 giây; redirect từ trình duyệt không thay thế xác nhận thanh toán của server.

### Hủy đơn và scheduled sweep

Checkout dùng `payment=success|error|cancel` trên URL quay về để hiển thị đúng kết quả từ trình duyệt. Đây chỉ là thông tin UI, không cập nhật trạng thái thanh toán. Chủ workspace có thể bấm **Hủy đơn nếu chưa thanh toán**; `POST /api/billing/orders/cancel` xác thực session, workspace đang hoạt động và quyền owner, kiểm tra SePay trước khi hủy, rồi đối soát lại. Không tự hủy đơn chỉ vì truy cập URL `payment=cancel`.

Tra cứu chi tiết thử mã invoice trước (theo [SDK chính thức](https://github.com/sepayvn/sepay-pg-node/blob/main/src/order.ts)); chỉ khi HTTP 404 mới tìm invoice chính xác trong danh sách và thử provider order ID. Mỗi response phải khớp invoice, tiền và currency trước khi thay đổi billing. `CANCELLED`/`CANCELED` được chuẩn hóa thành `cancelled`; `CAPTURED` cần giao dịch approved khớp trước khi cấp quyền lợi.

**Thiết lập trước khi chạy:**

1. Chạy `pnpm db:push` từ `frontend/` để đồng bộ các cột maintenance và index mới trong `src/db/schema.ts`.
2. Tạo `BILLING_SWEEP_SECRET` bằng `openssl rand -hex 32`, cấu hình cùng giá trị ở app và scheduler; không dùng merchant/IPN secret. `.env.example` có biến này. Cấu hình `BILLING_PUBLIC_BASE_URL` hoặc `BETTER_AUTH_URL` trỏ đến app.
3. Chạy app và thử `pnpm billing:sweep` từ `frontend/` (Node 22+). Script gửi một POST authenticated; exit khác 0 nếu request lỗi. Không cần BullMQ/Redis.
4. Cấu hình scheduler chạy mỗi phút, ví dụ cron trên server có repo, Node và `.env`:

   ```cron
   * * * * * cd /absolute/path/to/frontend && /absolute/path/to/node --env-file=.env scripts/billing-sweep.mjs >> /absolute/path/to/billing-sweep.log 2>&1
   ```

   Có thể dùng HTTP scheduler gọi `POST https://your-app/api/internal/billing/expire-orders`, header `Authorization: Bearer <BILLING_SWEEP_SECRET>`. Dùng HTTPS khi gọi qua internet. Cho phép request chạy ít nhất 90 giây. Việc thêm endpoint không tự tạo scheduler; phải thiết lập cron/HTTP scheduler trong môi trường chạy app.

Sweep tìm các đơn database `pending` đã quá `expiresAt` (30 phút), xử lý tối đa 10 đơn/lượt với 2 luồng. Mỗi đơn được claim bằng update atomic, lease 2 phút và token chống giải phóng nhầm lease; dùng chung với thao tác hủy thủ công. Crash tự nhả lease khi hết hạn. Retry lưu trong PostgreSQL, backoff 1/2/4/8/16/32 phút rồi tối đa 1 giờ; ưu tiên thời điểm retry để đơn lỗi không chặn các đơn khác.

Sweep đối soát trước: đã trả tiền → cấp quyền lợi qua luồng hiện có; đã hủy → cập nhật local; unpaid `AUTHENTICATION_NOT_NEEDED` → gọi cancel API rồi kiểm tra lại. Thanh toán thẻ/giao dịch approved khi order chưa CAPTURED/trạng thái chưa rõ/không tìm thấy/API lỗi được giữ unresolved và retry; không suy luận đã hủy từ timeout, 404 hay chỉ hết 30 phút. Cancel API lỗi cũng được kiểm tra lại vì có thể vừa nhận IPN/hoàn tất hủy. Status update có điều kiện bảo vệ IPN đến đồng thời. Tiền đến sau khi local đã hủy được ghi `review` theo chính sách hiện có; giữ nguyên lịch sử đơn.

Endpoint trả `{ processed, cancelled, paid, review, retry, skipped }` và log thống kê; retry từng đơn không làm thất bại cả batch. Theo dõi các lượt scheduler lỗi và `retry` kéo dài để hỗ trợ đối soát. Trang billing vẫn poll khi mở; sweep tiếp tục xử lý khi không ai mở trang.

Kiểm tra bằng `./node_modules/.bin/tsx --test src/lib/server/billing/*.test.ts` từ `frontend/` (toàn bộ test frontend: `pnpm test`, CI cũng chạy lệnh này). Test PostgreSQL chỉ chạy khi có `BILLING_TEST_DATABASE_URL` trỏ đến database tên kết thúc bằng `_test`; test tạo schema riêng và dọn schema sau khi hoàn tất, mock HTTP SePay và không truy cập database ứng dụng. Không dùng `DATABASE_URL` production cho test.

### Xóa phiên và tính lại năng lực

Xóa phiên đã kết thúc là soft delete: phiên được gỡ khỏi lịch sử và không còn truy cập được qua API người học, nhưng dữ liệu nội bộ được giữ để xử lý event đến muộn. Confirmation thông báo điểm năng lực và gợi ý luyện tập sẽ được tính lại, có thể tăng hoặc giảm.

Server đánh dấu xóa và tính lại các năng lực bị ảnh hưởng trong cùng transaction. Chỉ dùng điểm từ phiên completed chưa bị xóa, có `assessmentStatus` là `observed` hoặc `opportunity_missed`, và điểm đã áp dụng thành công (`profileAppliedAt` khác null), theo thứ tự áp dụng rồi session ID. `not_assessed` luôn bị loại khỏi cả áp dụng và rebuild profile: không đổi mastery, số điểm đã áp dụng hoặc last-practiced, và không đặt `profileAppliedAt`. Giữ công thức hiện có: điểm đầu làm mốc; điểm sau là `round(previous × 0.75 + score × 0.25)`. Nếu không còn điểm đã áp dụng, xóa profile năng lực đó. Không gọi lại AI, không reset marker đã áp dụng; retry không cộng lại điểm.

Grading và deletion cùng khóa learner khi sửa profile; deletion còn dùng khóa operation của session. Lỗi rebuild rollback cả dấu xóa. Xóa lại trả 204, phiên chưa kết thúc hoặc operation đang chạy trả 409. Soft delete không phải xóa dữ liệu cá nhân vĩnh viễn; chưa có physical purge/restore.
Lịch sử, performance, coverage và profile năng lực được phân tách theo workspace của người học. Các API đọc/tạo/xóa phiên và performance yêu cầu workspace đang hoạt động, sẵn sàng; client gửi `x-workspace-id` để từ chối thao tác từ tab có workspace cũ. Soft delete chỉ tính lại profile trong workspace của phiên; khóa profile dùng cặp workspace và learner. End/abandon vẫn kiểm tra quyền thành viên trong workspace đã lưu của phiên để dừng cuộc gọi khi tab khác đổi workspace.

### Assessment coverage và gợi ý luyện tập

`GET /api/me/competencies` trả `assessedSessionCount`, `scenarioCount`, `evidenceLabel: "Limited evidence"` và `assessmentSummary` (ví dụ: “Assessed in 3 sessions across 2 practice scenarios.”), thay cho `confidence` và `evidenceCount`. Đếm session ID và practice ID khác nhau cho từng năng lực, chỉ từ điểm `observed` hoặc `opportunity_missed` đã áp dụng của chính người học trong phiên completed chưa xóa. Khi không còn điểm đủ điều kiện, các count bằng 0. Practice ID đo độ phủ bài luyện, không xác nhận tính đa dạng của nội dung kịch bản.

Các count là độ phủ đánh giá, không phải số quan sát đã xác thực hay độ tin cậy thống kê; không tăng nhãn thành “Emerging pattern” chỉ vì số phiên tăng. `evidenceCount` nội bộ vẫn là số bản ghi điểm đã áp dụng, không dùng để tính count API. Gợi ý luyện tập bỏ bonus theo confidence: need = `100 - (masteryScore ?? 50)`, priority lấy need lớn nhất (tối thiểu 0), trừ 50 cho bài có trong 5 phiên completed gần nhất chưa xóa và trừ 20 cho bài advanced khi có profile mastery dưới 60; trả top 3.

### Rubric có mức điểm và phản hồi có bằng chứng

Trainer định nghĩa `behaviors` (mã + hành vi), `levels` (mã, nhãn, điểm cố định, mã hành vi bắt buộc) và `criticalErrors` (mã, mô tả, trần điểm). Form và Excel cho phép thêm/xóa/chỉnh các hàng. Mức đầu phải là 0, không yêu cầu hành vi; các mức sau tăng dần và có điều kiện rõ ràng. Server chọn mức cao nhất đủ hành vi được chứng minh, rồi áp trần thấp nhất trong các lỗi đã được chứng minh. Không nội suy; lặp bằng chứng không cộng điểm. Bộ seed dùng mức 0/40/70/90/100 và trần cụ thể như chính sách khởi đầu có thể chỉnh, chưa được hiệu chuẩn thực nghiệm.

Evaluator chỉ trả `competencyAssessments` với structured findings, không trả điểm hay narrative tự do. Mỗi finding có rule ID, rationale và evidence trỏ đến turn thật; lỗi bỏ lỡ phải chỉ ra cơ hội và lượt người luyện phản hồi sau đó. Trích dẫn phải khớp nguyên văn. Objective và objection outcomes cũng cần bằng chứng khi được đánh giá. Không đủ bằng chứng → `not_assessed`, score null. Server tính điểm và lưu findings, rubric snapshot, level/cap proof; strengths/improvements/coaching và summary findings được suy ra từ findings, có link về hội thoại. Summary chỉ nêu coverage, không thêm phán đoán hành vi độc lập.

Phản hồi sau phiên và trang Năng lực của tôi chỉ hiển thị tên năng lực, mô tả hành vi/lỗi và nhãn mức đạt; không hiển thị mã competency, finding, behavior, level hoặc critical error. Các mã vẫn được giữ trong dữ liệu để đối chiếu và tính điểm. Bằng chứng, lý do ghi nhận, trần điểm và link về lượt hội thoại vẫn hiển thị.

Nếu transcript kết thúc ở câu hỏi của khách mà chưa có lượt người luyện đáp lại, không dùng câu hỏi đó làm bằng chứng bỏ lỡ. Omission phải có opportunity trước response; cùng một turn không thể đóng cả hai vai. Validator giữ quy tắc này và trả sequence arrays, invalid response sequences, later learner sequences cùng hướng dẫn bỏ finding chưa đủ bằng chứng cho lần regenerate. Findings hợp lệ ở các cơ hội trước vẫn được giữ; nếu không còn finding đủ bằng chứng, competency là `not_assessed`.

Model generation dùng các finding shapes riêng: demonstrated/attempted và critical error dạng thực hiện bắt buộc `behaviorEvidence` không rỗng; opportunity_missed và critical error dạng bỏ sót bắt buộc cả `opportunityEvidence` và `responseEvidence` không rỗng. Mỗi shape có `contextEvidence` (có thể rỗng), không có evidence role tùy ý hay reference arrays lặp lại. JSON Schema anyOf cấm collections không phù hợp finding kind ngay khi generate. Python hợp nhất evidence, suy ra opportunity/response arrays và kiểm tra wire contract hiện có. Turn choices bị giới hạn theo collection/transcript; chronology, speaker, quote và rule ID vẫn được kiểm tra. Không swap/drop finding hay bịa observations; frontend và dữ liệu lưu giữ contract cũ, không cần migration.

Retry feedback giữ field path và thông báo rule cố định từ custom validators (ví dụ thiếu `behavior` evidence), không chỉ `value_error`. Không serialize rejected input, generated rationale/observation hoặc generic enum messages có thể echo model text; log và internal error dùng cùng diagnostic đã giới hạn tối đa 5 lỗi.

**Development cutover:** schema và wire contract thay đổi, không có shim hay migration cho dữ liệu rubric cũ. Sau khi bạn xóa dữ liệu development liên quan, chạy `pnpm db:push` rồi `pnpm db:seed-practices`; frontend và voice backend cần deploy cùng nhau. Seed bỏ qua bài đã tồn tại nên chạy lại seed không tự chuyển rubric cũ. Không tự động xóa dữ liệu hoặc thay điểm lịch sử.

Transcript và các evidence links hiển thị “Lượt 1, 2, 3…” theo vị trí trong toàn bộ transcript của session. Event `sequence` có thể có khoảng trống vì lifecycle/interruption events dùng chung bộ đếm; vẫn giữ nguyên sequence trong DB, evaluator references và anchor `transcript-turn-{sequence}`. Performance trả thêm `displayNumber` cho evidence turn từ full-session transcript, không đánh số lại riêng mỗi trích dẫn.

### Năng lực của tôi (`/performance`)

Trang tổng hợp bằng chứng coaching của chính người học, mặc định 60 ngày gần đây, có tùy chọn toàn bộ thời gian. Chỉ dùng phiên completed chưa xóa, theo thời điểm hoàn thành và session ID (không theo thứ tự chấm). Hoạt động gồm số phiên, phút luyện, số bài khác nhau, cold/warm coverage và phiên chưa có đánh giá. Đánh giá đã lưu vẫn dùng được khi cập nhật profile thất bại; không phụ thuộc `profileAppliedAt` hay pooled `masteryScore`.

Kỹ năng được tách theo loại gọi, độ khó từ practice bất biến mà session tham chiếu và rubric snapshot đã lưu trong assessment. Một điểm hiển thị như kết quả phiên; nhiều điểm có observed min–max và chronology, không phải khoảng tin cậy. Hiển thị phiên demonstrated, attempted, opportunity_missed, critical_error và not_assessed riêng; không gán readiness/proficiency hoặc tự giảm điểm theo tuổi bằng chứng. Phiên cũ vẫn có ngữ cảnh qua practiceId; chỉ báo thiếu ngữ cảnh khi bản ghi practice thực sự không tìm thấy.

Recurring findings nhóm theo context + rubric + rule + kind, yêu cầu ít nhất hai session khác nhau; lặp finding trong một session không cộng count. Ví dụ từ phiên điểm cao/thấp gồm rationale, lời trích được đối chiếu và đầy đủ turn liên quan, có link về session/turn. Objection rate dùng số phản đối đã raised, chia handled/partially/not handled; insight share dùng discovered/(discovered+missed) cấu hình bài; objective rate dùng assessed objectives, có unassessed riêng và tách cold/warm. Đây là kết quả trong bài luyện, không phải đo lường kỹ năng tổng quát.

Next focus ưu tiên recurring improvement khi có practice published phù hợp context và rubric, kèm evidence; nếu chưa có thì đề xuất lấp coverage gap và nói rõ thiếu dữ liệu không có nghĩa kỹ năng yếu. Không gọi LLM để tạo assessment mới. `GET /api/me/performance?period=recent|all` và server function yêu cầu authenticated, email verified; response API `private, no-store`, không nhận userId từ client. Xóa phiên hoặc hoàn thành/retry evaluation làm mới performance query.

### Immutable practice references

Session tham chiếu practice đã publish bằng `practiceId`, không sao chép definition vào từng session. Material changes tạo practice mới và archive bản cũ; config, offering và rubric của practice được giữ để đọc lịch sử và chấm phiên trễ. Completed transcript là dữ liệu finalized. Voice start, evaluation và performance dùng các reference đó; learner response vẫn chỉ chiếu nội dung công khai, không serialize config/rubric riêng tư.

Evaluator trả trực tiếp structured assessment; không có metadata envelope, model/prompt attribution, transcript hash hoặc frozen evaluation input. Findings, rubric snapshot và level/cap explanation đã lưu vẫn giữ nguyên. Không backfill hay regrade kết quả lịch sử; pooled profile và catalog recommendation không thay đổi.

**Schema cleanup:** schema đã bỏ `practice_sessions.practice_snapshot`, `.evaluation_input`, `practice_session_evaluations.evaluation_context`. Nếu các cột này đã được áp dụng, review kế hoạch `pnpm db:push` trước khi bỏ cột chứa dữ liệu dư thừa. Không cần wipe/reseed. Frontend và voice backend cần deploy cùng nhau vì response evaluator trở lại direct assessment.

**3) Các thư viện chính**

**Components library**:

- Dự án này sử dụng thư viện components [Shadcn](https://ui.shadcn.com/).
- Để thêm các component mới:

  ```bash
  pnpm dlx shadcn@latest add
  ```

**T3Env**:

- T3Env để quản lý biến môi trường, đảm bảo type safety
- Thêm các biến môi trường vào file `src/env.ts`.
- Sử dụng các biến này:

  ```ts
  import { env } from '#/env'
  console.log(env.VITE_APP_TITLE)
  ```

**Better Auth**:

- Chạy lệnh sau để tạo `BETTER_AUTH_SECRET` trong `.env`:

  ```bash
  pnpm dlx @better-auth/cli secret
  ```

## 2. TanStack Start Framework

### 2.1 Định tuyến (Routing)

Dự án dùng [TanStack Router](https://tanstack.com/router) với cơ chế định tuyến dựa trên tệp. Mỗi tệp trong `src/routes` định nghĩa một tuyến.

#### 2.1.1 Tạo tuyến (route)

Để thêm tuyến, hãy tạo một tệp mới trong thư mục `src/routes`. TanStack Router sẽ nhận diện tệp và tạo tuyến tương ứng.

Khi ứng dụng có nhiều tuyến, bạn có thể dùng component `Link` để chuyển giữa các tuyến.

#### 2.1.2 Tạo liên kết (Link)

Để điều hướng trong ứng dụng một trang (SPA), hãy nhập component `Link` từ `@tanstack/react-router`.

```tsx
import { Link } from '@tanstack/react-router'
```

Sau đó, dùng component này trong JSX như sau:

```tsx
<Link to="/about">Giới thiệu</Link>
```

Liên kết này sẽ chuyển đến tuyến `/about`.

Xem thêm về component `Link` trong [tài liệu Link của TanStack Router](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

#### 2.1.3 Tạo bố cục (Layout)

Bố cục của cơ chế định tuyến dựa trên tệp nằm trong `src/routes/__root.tsx`. Nội dung trong tuyến gốc sẽ xuất hiện ở mọi tuyến. Nội dung của từng tuyến được hiển thị tại vị trí `{children}` trong `shellComponent`.

Ví dụ sau tạo bố cục có phần đầu trang:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Ứng dụng của tôi' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="vi">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Trang chủ</Link>
            <Link to="/about">Giới thiệu</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

Xem thêm về bố cục trong [tài liệu bố cục của TanStack Router](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

### 2.2 Server functions

TanStack Start cung cấp "server functions" để bạn viết mã chạy trên máy chủ và gọi hàm đó từ component phía máy khách.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Dùng trong component
function MyComponent() {
  const [time, setTime] = useState('')

  useEffect(() => {
    getServerTime().then(setTime)
  }, [])

  return <div>Thời gian máy chủ: {time}</div>
}
```

### 2.3 Tuyến API

Để tạo tuyến API, hãy dùng thuộc tính `server` trong phần định nghĩa tuyến:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Xin chào, thế giới!' }),
    },
  },
})
```

### 2.4 Tải dữ liệu

Dự án có thể tải dữ liệu bằng nhiều cách. Dùng TanStack Query để lấy dữ liệu từ máy chủ, hoặc dùng `loader` của TanStack Router để tải dữ liệu cho tuyến trước khi giao diện được hiển thị.

Ví dụ:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

`loader` giúp gom logic tải dữ liệu vào phần định nghĩa tuyến. Xem thêm về tham số của `loader` trong [tài liệu tải dữ liệu của TanStack Router](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).

### Tìm hiểu thêm

Xem thông tin về các thư viện và công cụ của TanStack trong [tài liệu TanStack](https://tanstack.com).

Xem [tài liệu TanStack Start](https://tanstack.com/start) để biết thêm về TanStack Start.
