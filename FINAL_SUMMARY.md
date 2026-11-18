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

## Độ mới của bản đồ ngày 18/11/2026

OTA mới nhất trên kênh GitHub mặc định là **1.1.2**, phát hành lúc **07:51:11 ngày 18/11/2026** (giờ Việt Nam). SHA-256 của ZIP trên GitHub khớp tệp cục bộ. Cả 10 trường dữ liệu địa lý trích từ gói 1.1.2 giống bản APK gốc 1.0.9 và tập dữ liệu trong repo. Các kết quả thử GPS ở phần trên áp dụng cho APK 1.0.9 và gói 1.1.1. [Bản phát hành OTA 1.1.2](https://github.com/hongphuc120399-netizen/dinh-ops-3d/releases/tag/ota-v1.1.2)

Bản chụp OpenStreetMap trên Overpass lúc 07:49 giờ Việt Nam và API chính của OpenStreetMap lúc 07:51 cho cùng số đoạn trong khung dữ liệu Núi Dinh. Phép so dùng ba loại đường mà app đóng gói (`path`, `track`, `footway`) trong phạm vi 10,502–10,575° Bắc và 107,090–107,168° Đông.

| Lớp kiểm tra | Kết quả |
|---|---|
| Bốn tuyến đi bộ có màu | Khớp hình học và thứ tự của toàn bộ 33 đoạn. Đỏ 13, vàng 7, xanh lá 4 và xanh dương 9. |
| Đường mòn ngoại tuyến | Cả 281 đoạn có trong app đều khớp tên, loại đường và toàn bộ tọa độ OSM khi làm tròn đến 6 chữ số thập phân. OSM có 286 đoạn thuộc ba loại trên trong cùng phạm vi. |
| Năm đoạn vắng trong lớp đường ngoại tuyến | Hai đoạn `path` và ba đoạn `track`, đều nằm hoàn toàn trong khung bản đồ. Đoạn được sửa gần nhất trong số này có ngày 18/10/2026. Cả năm đã có trước lần đưa dữ liệu vào repo ngày 14/11/2026. |
| Địa danh | Tọa độ của 40/40 điểm có mã OSM node khớp với API hiện hành ở độ chính xác app lưu. Những điểm do app bổ sung thủ công nằm ngoài phép so này. |
| Ảnh vệ tinh | App thiếu ngày chụp và thông tin phiên bản ảnh. Khi có cả mạng và ảnh đã lưu, phép thử hàm tải cho thấy 0 yêu cầu mạng. Nút tải lại khu vực cũng dùng hàm này. |
| Địa hình 3D | Lưới cao độ đóng gói không ghi ngày thu nhận. Ngày build app không cho biết ngày đo cao độ hoặc ngày chụp ảnh. |

[Bốn tuyến trên OpenStreetMap — đỏ](https://www.openstreetmap.org/relation/19283687) · [vàng](https://www.openstreetmap.org/relation/19288810) · [xanh lá](https://www.openstreetmap.org/relation/19288815) · [xanh dương](https://www.openstreetmap.org/relation/19288823). [Năm đoạn đường đối chiếu trên API OSM](https://api.openstreetmap.org/api/0.6/ways.json?ways=1569335449,1347890719,266977371,266851660,266851662). [Google giải thích ngày chụp ảnh](https://support.google.com/earth/answer/6327779?hl=vi).

## Đối chiếu với các nguồn ngoài OpenStreetMap

**Bảng chỉ đường tại núi.** Ảnh bảng do Life of Doing công bố ghi năm cung. Mục chọn tuyến trong app có bốn. Hệ quả là người đọc bảng thấy hai lựa chọn xanh lá trong khi app chỉ cho chọn một. Ảnh ghi nhận cách đặt tên tại thời điểm chụp. Chưa xác định biển hiện tại có thay đổi hay tuyến Green 3 km đi theo những đoạn cụ thể nào trong dữ liệu app. [Ảnh bảng tại Núi Dinh, đọc được chú giải](https://lifeofdoing.com/wp-content/uploads/2021/03/Nui-Dinh-Mountain-Trail-Map.jpg) · [Bài viết của người chụp](https://lifeofdoing.com/hiking-nui-dinh-mountain/)

| Cung | Trên bảng | Trong danh sách tuyến của app |
|---|---:|---:|
| Đỏ | 13 km | 13,6 km |
| Vàng | 11 km | 10,3 km |
| Xanh dương | 7 km | 7,3 km |
| Green Plus và Green | 5 km và 3 km | Một cung Green 4,6 km |

**Hành trình người đi bộ ghi lại.** Jolie Tran Nguyen đăng hành trình tháng 8/2026 qua Hồ Bên Suối, Suối Đá, Cầu Nhật Bản và Đỉnh La Bàn. Wikiloc hiển thị 2.077 điểm, khoảng 13,3 km và có ảnh dọc đường. Một bản ghi tháng 5/2025 của Hiếu Nguyễn Hoàng đi từ Hồ Bên Suối qua năm hồ lên La Bàn rồi quay lại. Các bản ghi xác nhận trải nghiệm vào thời điểm đi. Chưa đo độ lệch với app từ tệp tọa độ gốc của hai người. [Chuyến tháng 8/2026](https://www.wikiloc.com/hiking-trails/nui-dinh-dinh-la-ban-trekking-rung-nui-278635771) · [Chuyến tháng 5/2025](https://www.wikiloc.com/hiking-trails/nui-dinh-ho-ben-suoi-dinh-la-ban-215937993)

**Đo từ tệp GPX công khai.** Với từng tệp, chia đường đi thành các đoạn tối đa 10 m, lấy khoảng cách từ trung điểm đến đoạn đường gần nhất trong 281 đoạn ngoại tuyến của app rồi cộng chiều dài nằm trong ngưỡng 30 m. Tỷ lệ dưới đây tính theo chiều dài của từng GPX. Nguồn không ghi giờ tại từng điểm của hai lộ trình tập, nên chưa xác định được cách tạo hình học hoặc lần đi gần nhất. [Trang công bố GPX của Thế Giới Chạy Bộ](https://www.thegioichaybo.vn/blogs/maps/ban-do-nui-dinh-gpx)

| Hành trình | Dài theo tệp | Tỷ lệ chiều dài trong phạm vi 30 m |
|---|---:|---:|
| [Hồ Bên Suối – Suối Đá (5 hồ) – La Bàn](https://file.hstatic.net/200000550479/file/hbs_suoi_da_nam_ho_la_ban.gpx) | 4,26 km | 96,4% |
| [Hồ Bên Suối – Thiền Viện – La Bàn](https://file.hstatic.net/200000550479/file/hbs_thien_vien_la_ban.gpx) | 5,56 km | 79,8% |
| [Dinh Harvest Final 25K](https://file.hstatic.net/200000550479/file/dhfinal_-_route_25k_official.gpx) | 27,73 km | 91,1% |

**Sự kiện và ảnh vệ tinh có ngày.** Bảng kết quả Dinh Harvest Flowers ghi nhận giải tại Hồ Bên Suối ngày 17/10/2026. Copernicus có cảnh Sentinel-2C phủ đỉnh Núi Dinh chụp lúc 10:10 ngày 17/11/2026 theo giờ Việt Nam. Ảnh màu có độ phân giải 10 m/pixel và tỷ lệ mây 34,27% trên toàn cảnh. Dữ liệu này dùng để xem lớp phủ trên diện rộng. Tình trạng từng lối mòn hẹp dưới tán cây ngày 18/11 vẫn cần xác nhận tại chỗ. [Kết quả giải](https://tikpik.vn/events/dinh-harvest-flowers/results/) · [Cảnh ảnh Copernicus](https://browser.stac.dataspace.copernicus.eu/collections/sentinel-2-l2a/items/S2C_MSIL2A_20261117T031011_N0513_R075_T48PYS_20261117T064903)
