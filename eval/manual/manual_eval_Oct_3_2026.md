# Manual Evaluation with evidence — 5 test cases

## 1. Thông tin lần chạy

| Trường | Giá trị |
|---|---|
| Thời gian chạy, múi giờ | 14:00 ngày 03/10/2026 |
| URL / môi trường | https://c4-app-t067.wingdo.net |

Mẫu được đối chiếu với mã nguồn tại HEAD `396b6bd`.

## 2. Danh sách ca kiểm thử

| ID | Nội dung | Bài luyện | Kết quả |
|---|---|---|---|
| TC-01 | Hội thoại giọng nói và transcript tiếng Việt | Gọi lần đầu - Anh Minh | PASS |
| TC-02 | AI phản đối khi khách đang bận và phản ứng theo cách xử lý | Gọi lần đầu - Anh Minh | PASS |
| TC-03 | Gọi lại, khai thác băn khoăn và chốt bước tiếp theo | Gọi lại - Chị Lan | PASS |
| TC-04 | Phát hiện tư vấn sai giá và pháp lý trong đánh giá | Gọi lần đầu - Anh Minh | PASS |
| TC-05 | Feedback không bịa bằng chứng khi phiên rất ngắn | Gọi lần đầu - Anh Minh | PASS |

PASS = đạt toàn bộ tiêu chí của ca và có bằng chứng; FAIL = có tiêu chí không đạt, ghi rõ; BLOCKED = thiếu điều kiện để chạy/đánh giá; NOT RUN = chưa chạy. Không coi thiếu bằng chứng là PASS. Điểm kỹ năng thấp của người bán không đồng nghĩa sản phẩm FAIL.

## 3. Chi tiết kiểm thử

### TC-01 — Hội thoại giọng nói và transcript tiếng Việt

**Mục tiêu:** Kiểm tra vòng nói → nhận dạng → AI trả lời bằng giọng nói → hiển thị hội thoại.

**Các bước và input:**
1. Mở bài Anh Minh, ghi ID bài; chọn **Bắt đầu luyện tập**, cấp quyền micro.
2. Chờ khách AI mở lời. Nói: “Em chào anh Minh, em là Thành, tư vấn dự án Sunrise Riverside. Em gọi theo thông tin anh đăng ký nhận bảng giá. Anh có tiện trao đổi hai phút không ạ?”
3. Khi khách đồng ý, hỏi: “Anh đang tìm căn hộ để ở hay đầu tư ạ?” Chờ trả lời rồi hỏi tiếp một câu phù hợp với câu trả lời thực nhận.
4. Chọn **Kết thúc** và xác nhận. Lưu transcript và video có âm thanh nếu có.

**Expected output / tiêu chí đạt:** Kết nối được; nghe được khách AI; transcript phân biệt đúng khách/người bán và giữ đúng ý các câu đã nói. AI trả lời liên quan đến lượt hỏi, giữ vai khách Anh Minh. Phiên kết thúc được. Ghi riêng mọi lỗi nhận dạng tên riêng; không suy ra độ chính xác STT toàn hệ thống từ ca này.

**Actual output:** 
    
    [15:42:08] Anh Minh: Alo… ai đấy?

    [15:42:09] Bạn: đấy.

    [15:42:14] Bạn: em chào anh Minh em là Thành tư vấn dự án Sunrise Riverside.

    [15:42:19] Bạn: em gọi tra thông tin anh đăng ký nhận bảng giá trên Facebook anh có tiện trao đổi hay phút không ạ?

    [15:42:23] Anh Minh: Anh đang bận lắm, em nói nhanh cái. Dự án này ở đâu vậy?

    [15:42:29] Bạn: dạ anh đang tìm căn hộ để ở hay đầu tư ạ?

    [15:42:35] Anh Minh: Anh tìm mua để ở, chứ không đầu tư. Vợ anh quyết định chung, mà anh thì ưu tiên gần trường học cho con.

**Evidence:** [https://drive.google.com/open?id=1NIitnu1YuUOgvMC51yiLv7qp7l489CAT&usp=drive_fs]

**Result:** PASS · **Sai khác/ghi chú:** Luồng thực tế khác kịch bản dự kiến: khách AI báo đang bận và hỏi vị trí dự án, chưa đồng ý trao đổi; người bán chuyển sang câu hỏi khai thác nhu cầu thay vì trả lời câu hỏi về vị trí. Transcript có lỗi STT nhỏ: “theo thông tin” thành “tra thông tin” và “hai phút” thành “hay phút”; chưa thấy lỗi làm sai ý chính hoặc AI rời vai khách Anh Minh.

### TC-02 — Xử lý phản đối “đang bận”

**Mục tiêu:** Kiểm tra AI tạo phản đối đúng bối cảnh và phản ứng với cách người bán xử lý.

**Các bước và input:**
1. Mở phiên mới của bài Anh Minh.
2. Sau lời chào của AI, nói: “Em chào anh, em là Thành bên tư vấn căn hộ Sunrise Riverside, em muốn giới thiệu căn hộ cho anh.” Cố ý chưa nhắc nguồn đăng ký và chưa xin phép trao đổi.
3. Ghi phản ứng thực tế. Nếu khách nói bận hoặc yêu cầu gửi Zalo, nói: “Dạ em hiểu anh đang bận. Em gọi vì anh có đăng ký nhận bảng giá trên Facebook. Anh cho em xin hai phút, nếu không tiện em xin hẹn lại giờ phù hợp ạ.”
4. Ghi phản ứng tiếp theo, tôn trọng nếu khách vẫn từ chối; kết thúc phiên và lưu feedback.

**Expected output / tiêu chí đạt:** Theo cấu hình bài, AI nêu phản đối đang bận sau phần giới thiệu thiếu lý do liên quan. Khi người bán nhắc đúng nguồn và xin hai phút, phản ứng dịu lại phù hợp bối cảnh; không bắt buộc câu trả lời giống từng chữ trong seed. Feedback về xử lý phản đối phải phù hợp với những lượt thực sự xảy ra. Nếu AI không nêu phản đối, ghi FAIL ở tiêu chí tạo tình huống; phần xử lý chưa được kiểm chứng.

**Actual output:** 

    [16:17:09] Anh Minh: Alo… ai đấy?

    [16:17:10] Bạn: đấy.

    [16:17:16] Bạn: em chào anh em là thành bên tư vấn căn hộ sunrise riverside em muốn giới thiệu căn hộ cho anh.

    [16:17:20] Anh Minh: Anh đang bận, em nói nhanh lý do gọi đi.

    [16:17:24] Bạn: dạ em hiểu anh đang bận.

    [16:17:30] Bạn: em gọi vì anh có đăng ký nhận bảng giá trên Facebook, anh cho em xin hai phút nếu không tiện em xin hẹn lại giờ phù hợp.

    [16:17:36] Anh Minh: À, anh có để lại số xem bảng giá hả? Thế dự án ở đâu vậy? Giá sao rồi?

    [16:17:45] Bạn: dự án tại quận bảy thành phố hồ chí minh hiện tại thì căn hộ đang dao động giá khoảng hai tỷ rưỡi ạ.

    [16:17:51] Anh Minh: Hai tỷ rưỡi là giá đã gồm thuế, phí chưa? Với khoản trả góp hàng tháng khoảng bao nhiêu?

    [16:17:55] Bạn: dạ.

    [16:17:57] Bạn: đã bao gồm thuế ạ.

    [16:18:05] Anh Minh: Còn phí bảo trì thì sao? Pháp lý dự án có sổ hồng chưa? Anh quen mấy dự án chậm ra sổ nên hơi e ngại khoản đó.

**Evidence:** [https://drive.google.com/open?id=1kj3DvEp9rBN3risK7eI-dOuXN-pPSC6W&usp=drive_fs]

**Result:** PASS · **Sai khác/ghi chú:** AI phản đối đúng bối cảnh ngay sau phần giới thiệu thiếu lý do gọi: “Anh đang bận, em nói nhanh lý do gọi đi.” Khi người bán nêu nguồn đăng ký Facebook và xin hai phút, AI phản hồi theo hướng cởi mở hơn, xác nhận đã để lại số rồi hỏi vị trí và giá dự án; sau đó tiếp tục hỏi về thuế, phí bảo trì và pháp lý. Phản ứng không cần trùng từng chữ với seed và vẫn giữ đúng vai khách hàng. Phiên dừng khi AI đang hỏi thêm nên chưa có bằng chứng feedback cuối phiên; nội dung này không ảnh hưởng kết luận PASS cho luồng tạo phản đối và xử lý phản đối.


### TC-03 — Gọi lại cho chị Lan

**Mục tiêu:** Kiểm tra AI duy trì bối cảnh lần trước, tiết lộ băn khoăn khi được hỏi và đánh giá đúng bước tiếp theo.

**Các bước và input:**
1. Mở bài **Gọi lại - Chị Lan**, đọc bối cảnh và lịch sử trao đổi hiển thị.
2. Bắt đầu phiên, nói: “Em chào chị Lan, tuần trước mình trao đổi căn hai phòng ngủ Sunrise Riverside và em đã gửi bảng giá qua Zalo. Hôm nay em gọi lại theo hẹn, chị có tiện không ạ?”
3. Hỏi lần lượt, chờ AI trả lời từng câu: “Sau khi bàn với anh, điều gì khiến gia đình mình còn băn khoăn ạ?”; “Anh nhà lo cụ thể điều gì về khoản vay ạ?”; “Nguồn vốn ban đầu của mình hiện đã sẵn sàng chưa ạ?”
4. Phản hồi dựa trên câu trả lời thực tế, không hứa lãi suất ngoài thông tin bài. Đề nghị một ngày giờ cụ thể do người kiểm thử chọn, mời cả hai vợ chồng xem nhà mẫu hoặc gặp tư vấn tài chính; ghi nguyên văn lịch đã đề nghị và phản ứng của khách.
5. Kết thúc, xem điểm kỹ năng, nhận xét và bằng chứng.

**Expected output / tiêu chí đạt:** AI giữ bối cảnh đã trao đổi trước; khi được hỏi phù hợp, thể hiện nỗi lo lãi suất thả nổi của chồng và nguồn vốn từ đất chưa bán được theo seed. Feedback phân biệt đề nghị hẹn với việc khách thực sự đồng ý; không ghi nhận chốt thành công khi transcript chưa có xác nhận. Bằng chứng phải đúng nội dung/lượt nói.

**Actual output:** 

    [16:54:38] Chị Lan: Alo, chị nghe đây em.

    [16:54:48] Bạn: em chào chị Lan, tuần trước mình trao đổi căn hai phòng ngủ sân bay với sai và em đã gửi bảng giá qua zalo. Hôm nay em gọi lại theo hẹn, chị có tiện không ạ?

    [16:54:55] Chị Lan: Dạ, chị vẫn xem được bảng giá rồi. Hôm nay gọi chị nghe em nói có gì mới thì chị nghe.

    [16:55:00] Bạn: sau khi bàn với anh, điều gì đã khiến gia đình mình có băn khoăn ạ?

    [16:55:12] Chị Lan: Chồng chị lo khoản vay, lãi suất sau 12 tháng ưu đãi có thể tăng cao, nên chưa quyết được. Còn mảnh đất ở quê chưa bán xong nên cũng ảnh hưởng tiền đầu tư nữa.

    [16:55:23] Bạn: hiện tại ngân hàng thì đang hỗ trợ vay bảy mươi phần trăm còn về phần lãi suất thì do tùy từng thời điểm ngân hàng sẽ áp trên lãi suất

    [16:55:30] Bạn: để hôm nào em với chị tiện một buổi hẹn gặp nhau ạ để nói kỹ hơn về vấn đề này.

    [16:55:38] Chị Lan: Chị cũng muốn cân nhắc kỹ, nhưng để anh chị bàn thêm trước đã. Hẹn gặp thì chị báo lịch chính xác sau nhé.

    [16:55:40] Bạn: vâng dạ cảm ơn ạ.

**Evidence:** [https://drive.google.com/open?id=1S_lQvCOVNE9HHK77SmXl8fM_GEm_tVsO&usp=drive_fs]

**Result:** PASS · **Sai khác/ghi chú:** AI duy trì được bối cảnh của cuộc gọi lại: khách xác nhận đã xem bảng giá gửi qua Zalo và sẵn sàng nghe thông tin mới. Khi được hỏi, chị Lan nêu đúng hai băn khoăn chính là lãi suất có thể tăng sau 12 tháng ưu đãi và nguồn vốn còn phụ thuộc vào mảnh đất ở quê chưa bán xong. Người bán đã đề nghị một buổi gặp để trao đổi kỹ hơn; khách chưa chốt lịch cụ thể mà hẹn sẽ bàn thêm với chồng rồi báo lại.  

### TC-04 — Người bán cố ý nói sai thông tin sản phẩm

**Mục tiêu:** Kiểm tra bộ đánh giá phát hiện lỗi nghiêm trọng theo rubric.

**Tiền điều kiện riêng:** Bài Anh Minh đang dùng căn 2PN có giá seed 2,5 tỷ VND; pháp lý “Đã có giấy phép xây dựng, sổ hồng sau khi bàn giao”. Nếu dữ liệu thực tế khác, xác định lại câu sai trước khi chạy.

**Các bước và input:**
1. Mở phiên mới, giới thiệu và xin phép trao đổi.
2. Cố ý nói câu sai trong phiên luyện: “Căn hai phòng ngủ này giá một tỷ rưỡi và đã có sổ hồng rồi anh nhé.”
3. Kiểm tra transcript có ghi nhận đúng hai thông tin sai trên. Nếu STT ghi sai input, ghi sự cố và chạy lại bằng phiên mới; giữ bằng chứng lần lỗi.
4. Kết thúc phiên, mở phản hồi và điểm theo kỹ năng.

**Expected output / tiêu chí đạt:** Feedback nhận diện cả sai giá và sai pháp lý, bám vào thông tin sản phẩm và lời người bán. Không khen phát biểu sai là tư vấn chính xác. Nếu có quote/số lượt, phải khớp transcript. Không đặt ngưỡng điểm trừ vì chưa có quy tắc điểm trừ cố định được xác nhận.

**Actual output:** 

    [17:04:39] Anh Minh: Alo… ai đấy?

    [17:04:43] Bạn: em chào anh Minh em là Thành.

    [17:04:47] Bạn: bên tư vấn căn hộ Sanrari và Sai em muốn giới thiệu căn hộ cho anh.

    [17:04:52] Anh Minh: Anh đang bận, em nói ngắn thôi, căn hộ giá bao nhiêu?

    [17:04:58] Bạn: căn phòng căn hai phòng ngủ này giá một tỷ rưỡi và đã có sổ hồng rồi anh nhé.

    [17:05:07] Anh Minh: Một tỷ rưỡi là ở đâu vậy? Tôi đang tìm căn tầm 2 tỷ tới hơn 2 tỷ chút, chứ một tỷ rưỡi chắc không đủ. Còn sổ hồng rõ ràng thì tôi cần xem kỹ.

**Evidence:** [https://drive.google.com/open?id=1B6hcwd6XtHE1O0LRrwvHc7Q5pVeHI49x&usp=drive_fs]

**Result:** PASS · **Sai khác/ghi chú:** Transcript ghi nhận đầy đủ hai thông tin cố ý sai được đưa vào tình huống: người bán nói căn 2PN có giá “một tỷ rưỡi” và “đã có sổ hồng rồi”. Khách AI phản hồi bằng cách đặt câu hỏi lại về mức giá và nhấn mạnh nhu cầu kiểm tra kỹ tính rõ ràng của sổ hồng. Tên dự án trong phần giới thiệu bị STT nhận dạng chưa chính xác, nhưng hai thông tin sản phẩm cần kiểm tra vẫn được thể hiện rõ trong transcript.
### TC-05 — Phiên ngắn, thiếu bằng chứng để đánh giá đầy đủ

**Mục tiêu:** Kiểm tra feedback chỉ dựa vào hành vi quan sát được.

**Các bước và input:**
1. Mở phiên mới của bài Anh Minh; sau lời khách mở đầu chỉ nói: “Em chào anh, em là Thành.”
2. Kết thúc phiên ngay, không hỏi nhu cầu, không tư vấn sản phẩm, không xử lý phản đối hay hẹn xem nhà.
3. Lưu toàn bộ transcript ngắn và chờ kết quả đánh giá. Ghi nhận nếu có lỗi hoặc không tạo được feedback.
4. Đối chiếu từng nhận xét và trích dẫn trong feedback với transcript.

**Expected output / tiêu chí đạt:** Tạo được phản hồi phù hợp lượng hội thoại thực có; không tuyên bố đã khai thác ngân sách, xử lý phản đối hoặc chốt lịch khi chưa xảy ra. Mọi quote và số lượt được hiển thị phải khớp transcript. Không yêu cầu điểm bằng 0 hay một câu thông báo cố định. Nếu đánh giá lỗi, ghi FAIL cho bước tạo feedback và chưa kết luận tính đúng đắn của phần chưa sinh ra.

**Actual output:** 

    [17:41:07] Anh Minh: Alo… ai đấy?

    [17:41:10] Bạn: em chào anh em là thành.

    [17:42:20] Anh Minh: Em gọi về việc gì vậy?

**Evidence:** 
- Conversation: [https://drive.google.com/open?id=1Q7lRswep81PXZA6P8Cq9hu20rX3K6i4h&usp=drive_fs] 
- Feedback: [https://drive.google.com/open?id=1TISRgtQv8ytiOirstqsOFw0NK_bE77mG&usp=drive_fs]

**Result:** PASS