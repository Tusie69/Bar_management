# PR #10 — Final Merge Approval

## Kết luận

**CONDITIONALLY_SAFE**

Bản tích hợp có thể chuyển sang bước người dùng review để chuẩn bị merge chính thức. Chưa được merge hoặc push tự động.

## Phiên bản đề xuất review

- Branch: `codex/pr10-selective-trial`.
- Commit: `fdbb27b`.
- Baseline: `1efcb53e0ff97c5e98f1ed24b8bac369cbae4e20`.
- PR head nguồn: `b3d84a811e20e43bf6bb5d7285f21f1d68120429`.
- 0 unresolved Git conflict.
- 0 dirty tracked file trước khi tạo báo cáo.

## Điều kiện đã đạt

- Backend local về auth, RBAC, CSRF, masking, business-day, Floor Projection và change_seq được giữ.
- Q03 và Q06 có commit backend riêng, test riêng và HTTP integration evidence.
- UI Sprint 2 cốt lõi đã hoàn thiện cho desktop/mobile, table-first, waitlist, whole-floor, responsive và polling.
- Q10 không bị thay bằng adjacency rule.
- Q13 priority database được giữ.
- HTTP production mode không sử dụng mock.
- Typecheck, lint, build, unit tests, NA-11 và Phase 2B đều đạt.
- MySQL full suite không có failure mới so với baseline.

## Điều kiện trước merge chính thức

1. Người dùng review diff từ `1efcb53..fdbb27b`, đặc biệt Q03, Q06 và UX mobile table-first.
2. Chấp nhận rõ ràng rằng 11 MySQL failures là backlog có trước và không phát sinh từ PR #10.
3. Merge theo các commit chọn lọc của integration branch. Không merge nguyên PR head lên trên vì phần bước 5 phút và HOLD Walk-in trái quyết định PO.
4. Sau merge, chạy lại cùng suite trong CI hoặc môi trường review có MySQL disposable.

## Không chặn merge, nhưng cần theo dõi

- Q04/Q05/Q07/Q08/Q09/Q11/Q12 chưa đủ đặc tả.
- Lint còn warning React hiện hữu, không có lint error.
- Vite báo waitlist page vừa dynamic import vừa static import. Build vẫn đạt, đây là tối ưu bundle sau merge.
- NFR nhiều thiết bị/realtime chưa xác minh.

## Rollback

Các thay đổi được tách thành commit:

- `752f0f7` — availability fixes và polling.
- `3ac4f6b` — whole-floor receptionist map.
- `dc9534a` — Q06 atomic Walk-in seating.
- `bc12929` — Q03 backend quarter-hour validation.
- `aa1e331` — legacy schedule và projection tests.
- `f808a53` — Sprint 2 UI integration.
- `fdbb27b` — Phase 2B E2E quarter-hour assertion.

Rollback có thể revert theo commit theo thứ tự ngược. Worktree gốc vẫn ở `develop@1efcb53`.

Không có merge vào `develop`, push remote, force push hoặc thay đổi database dev/production.
