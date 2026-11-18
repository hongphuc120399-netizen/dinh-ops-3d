# Kiểm tra bản đồ Núi Dinh và GPS khi đi bộ

Ngày 18/11/2026 · Phạm vi gồm APK gốc 1.0.9 và bản web đóng gói 1.1.1 trong repo. Đã kiểm tra dữ liệu, quyền Android và giao diện của cả hai bản. Chưa thử bộ thu GPS trên điện thoại hoặc đo tại Núi Dinh. Phiên bản đang cài trên máy người dùng chưa xác định.

## Kết quả đối chiếu bản đồ

Hai bản chứa cùng tập dữ liệu địa lý với `src/data/nuiDinhDataset.json`. Tâm bản đồ 2D là 10,5355° Bắc, 107,1285° Đông. Ba điểm trong app khớp bản ghi OpenStreetMap đến sáu chữ số thập phân.

| Địa danh | Vĩ độ trong app | Kinh độ trong app | Bản ghi đối chiếu |
|---|---:|---:|---|
| Đỉnh Núi Dinh, 491 m | 10,538922 | 107,129581 | [OpenStreetMap](https://www.openstreetmap.org/node/5537927332) |
| Núi Bao Quan, 504 m | 10,556903 | 107,132801 | [OpenStreetMap](https://www.openstreetmap.org/node/4789726675) |
| Chùa Hang Mai | 10,538695 | 107,125612 | [OpenStreetMap](https://www.openstreetmap.org/node/5537927353) |

Địa hình 3D, đường mòn và các điểm địa danh đi kèm bản cài. Ở năm điểm mẫu trải trên vùng núi, cao độ của lưới 3D chênh 0,4–17,5 m so với bộ Copernicus GLO-90. App mặc định phóng đại chiều cao 1,55 lần. Một số địa danh có tọa độ ước lượng, chẳng hạn khu vực thượng nguồn Suối Tiên được ghi sai số 100 m trong dữ liệu. [Nguồn cao độ đối chiếu](https://open-meteo.com/en/docs/elevation-api)

## Kết quả thử GPS và bản đồ ngoại tuyến

Đã chạy giao diện từ mã JavaScript trích trực tiếp trong APK và từ thư mục `dist` bằng Chromium trong phiên thử riêng. Đã dùng quyền vị trí, tọa độ và trạng thái mất kết nối do trình duyệt mô phỏng. APK khai báo hai quyền vị trí chính xác và gần đúng. App dùng `navigator.geolocation.watchPosition` qua Android WebView, yêu cầu độ chính xác cao. Chưa xác minh khả năng ghi hành trình khi khóa màn hình.

| Tình huống | Kết quả trên cả hai bản |
|---|---|
| Mở mới | Chế độ TEST, chấm giả lập tại Chùa Hang Tổ. |
| Bật GPS sau khi ngắt mạng | Nhận hai vị trí thử liên tiếp, cập nhật tọa độ và hiển thị sai số lần lượt ±8 m, ±12 m. |
| Từ chối quyền trước lần định vị đầu | Bảng GPS báo lỗi nhưng tọa độ giả lập vẫn hiện. |
| Mất định vị sau khi đã di chuyển | Bảng GPS báo lỗi nhưng chấm giữ nguyên ở tọa độ cuối. |
| Bấm tải ảnh trong khi mất mạng, kho ảnh trống | Giao diện hiện dấu ✅ và thông báo sẵn sàng dùng chế độ máy bay dù lưu 0/510 mảnh. |

Luồng ghi hành trình tự động có thể nối điểm giả ban đầu với điểm GPS thật và làm sai tổng quãng đường. Mã xử lý ở `src/App.tsx` dòng 413–457 và 771–790. Thông báo tải ảnh ở `src/components/TacticalPanels.tsx` dòng 739–750. Ba yêu cầu ảnh mẫu Google Hybrid, Vệ tinh và Địa hình ở tâm khu vực đều trả về ảnh JPEG khi thử có mạng.

## Cách kiểm tra trên điện thoại trước chuyến đi

1. Khi có Wi-Fi, vào **CÔNG CỤ → Offline → Tải Ảnh Vệ Tinh Google Núi Dinh Vào Máy**. Xem số sau chữ **Đã lưu**. Gói đầy đủ dự kiến có 510 mảnh.
2. Tắt Wi-Fi và dữ liệu di động, giữ **Vị trí** của Android bật. Mở lại app và phóng to đoạn đường dự định đi để kiểm tra ảnh đã lưu.
3. Ra chỗ thoáng, vào **TEST → Bật GPS Thật Của Máy**, cấp quyền **Vị trí chính xác** khi dùng app. Đợi dòng **GPS Thật (±…m)**, đi vài chục mét rồi kiểm tra tọa độ đổi theo. Có thể thử ngay gần nhà. Trong bản đồ 2D, bấm **TÔI** để đưa bản đồ về vị trí hiện tại.
4. Nếu thấy đang chờ hoặc báo lỗi, hãy coi chấm còn trên bản đồ là vị trí chưa được xác nhận. Khi cần ghi hành trình, hãy giữ app ở màn hình trước.

Việc kiểm tra chỉ tạo báo cáo này. Mã ứng dụng, APK và gói cập nhật giữ nguyên phiên bản đã kiểm tra.
