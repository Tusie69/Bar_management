/**
 * NA-32 — Focus của drawer sidebar trên tablet/điện thoại, tách thành hàm
 * thuần để test được mà không cần DOM.
 *
 * Đóng drawer bằng Escape hay bằng overlay thì focus phải quay về một chỗ có
 * nghĩa, không rơi về đầu trang. Nút mở menu là đích tự nhiên nhất, nhưng nó
 * bị `lg:hidden` ẩn đi khi màn hình vừa rộng ra trong lúc drawer đang mở —
 * focus vào một phần tử đã ẩn là mất focus. Khi đó mới lùi về sidebar desktop
 * rồi tới vùng nội dung.
 */

/** Khớp breakpoint `lg` của Tailwind, tức mức mà sidebar desktop hiện ra. */
export const ADMIN_DESKTOP_MEDIA_QUERY = "(min-width: 64rem)"

export function resolveDrawerCloseFocusTarget({
  trigger,
  isDesktop,
  desktopSidebar,
  mainContent,
}: {
  trigger: HTMLElement | null
  isDesktop: boolean
  desktopSidebar: HTMLElement | null
  mainContent: HTMLElement | null
}): HTMLElement | null {
  // `getClientRects()` rỗng nghĩa là phần tử không có hộp nào đang vẽ, tức là
  // đang bị ẩn — focus vào đó thì trình duyệt bỏ qua và focus rơi về body.
  const triggerVisible = !isDesktop && (trigger?.getClientRects().length ?? 0) > 0
  if (triggerVisible) return trigger

  return (
    desktopSidebar?.querySelector<HTMLElement>('a.adm-nav-item[aria-current="page"]') ??
    desktopSidebar?.querySelector<HTMLElement>("a.adm-nav-item") ??
    mainContent
  )
}
