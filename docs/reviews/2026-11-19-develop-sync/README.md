# Hồ sơ so sánh local với `origin/develop`

> Thời điểm chốt dữ liệu: 19/11/2026, múi giờ Asia/Saigon  
> Nhánh được bảo vệ: `feature/TU-38-turn-statistics-api` tại `ceb6aa7`  
> Develop được đối chiếu: `origin/develop` tại `1ccf73c`  
> Nguyên tắc: code local là nguồn ưu tiên; không checkout, merge, rebase hay stash trong quá trình lập hồ sơ.

## Mục đích

Bộ tài liệu này ghi lại đầy đủ trạng thái local, nội dung commit mới nhất trên `develop`, vùng chồng lấn và xung đột dự kiến. Đây là baseline để quyết định tích hợp sau này mà không làm mất thay đổi local.

## Kết luận nhanh

- Nhánh hiện tại đi trước `develop` 5 commit TU-38 và thiếu 1 commit redesign.
- Commit develop mới thay đổi 171 file, chủ yếu ở frontend: +20.952/−5.629 dòng.
- Local có 14 file sửa chưa commit và 1 file code mới chưa track tại thời điểm cập nhật baseline; script seed OWNER đã được commit ở `ceb6aa7`.
- Có 9 file local chưa commit bị develop sửa đồng thời.
- Merge giả lập phần đã commit phát hiện 5 xung đột nội dung chắc chắn.
- Không nên chạy `git pull`, merge hoặc rebase trước khi tạo checkpoint bảo vệ toàn bộ local.

## Danh mục tài liệu

1. [01-local-baseline.md](01-local-baseline.md): trạng thái local, commit, file chưa commit và file chưa track.
2. [02-develop-change-analysis.md](02-develop-change-analysis.md): phân tích nội dung commit develop theo từng module.
3. [03-overlap-and-integration-risk.md](03-overlap-and-integration-risk.md): file chồng lấn, xung đột và thứ tự tích hợp đề xuất.
4. [04-full-develop-file-inventory.md](04-full-develop-file-inventory.md): đủ 171 file develop, trạng thái, số dòng và mô tả.
5. [05-local-branch-file-inventory.md](05-local-branch-file-inventory.md): đủ 61 file đã commit của TU-38.
6. [06-merge-execution-report.md](06-merge-execution-report.md): kết quả merge thực tế, cách xử lý conflict và bằng chứng kiểm thử.

## Trạng thái thực hiện

Ngày 19/11/2026, `origin/develop@1ccf73c` đã được tích hợp vào nhánh feature sau khi tạo checkpoint `cec3c12` và nhánh backup `codex/backup-pre-develop-merge-20261119`. Chi tiết xác minh nằm trong báo cáo số 06.

## Mốc Git dùng để tái kiểm tra

```text
merge-base       46f071d6fd7cc63ac8517f264b48e06e1afb5704
local HEAD       ceb6aa7b4e4e85f9b58c48b34eef6343bcb52c9f
origin/develop   1ccf73ca4e7be5661097236fa0added989b95471
```

Các lệnh đối chiếu cốt lõi:

```powershell
git diff --name-status origin/develop^ origin/develop
git diff --numstat origin/develop^ origin/develop
git diff --name-status 46f071d..HEAD
git merge-tree --write-tree --messages HEAD origin/develop
```

`git merge-tree` chỉ dựng kết quả merge ảo; working tree không bị thay đổi.
