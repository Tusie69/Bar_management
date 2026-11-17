/**
 * TU-33 — Màn báo khi phiên bị kết thúc từ phía máy chủ.
 *
 * Trước đây việc này diễn ra trong im lặng: `expire()` gọi thẳng
 * `location.replace` về cổng đăng nhập, nên lễ tân đang nhập booking bỗng
 * thấy mình đứng ở trang đăng nhập. Câu giải thích có tồn tại trong store,
 * nhưng chuyển trang là một lần tải tài liệu mới nên nó chết trước khi kịp
 * hiện. Kết quả là nhân viên gọi điện hỏi "máy tự thoát".
 *
 * Màn này đứng lại giữa hai việc đó: nói rõ vì sao, nói rõ nội dung đang gõ
 * dở đã mất, rồi mới về trang đăng nhập.
 *
 * Nó KHÔNG giữ phiên lại thêm được một giây nào — máy chủ đã thu hồi phiên
 * trước khi sự kiện tới trình duyệt. Vì vậy ở đây không có nút "Ở lại", và
 * đếm ngược là để kịp đọc chứ không phải để làm nốt việc dở.
 */
import { LogIn, MonitorSmartphone } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  SESSION_END_NOTICE_SECONDS,
  sessionEndCountdownLabel,
  sessionEndMessage,
  sessionEndTitle,
  sessionEndUnsavedWarning,
} from "@/domain/session-end"
import { useSession } from "@/state/session"

export function SessionEndedNotice() {
  const code = useSession((state) => state.authEndCode) ?? "SESSION_INVALID"
  const message = useSession((state) => state.authError) ?? sessionEndMessage(code)
  const leaveToLogin = useSession((state) => state.leaveToLogin)
  const unsaved = sessionEndUnsavedWarning(code)
  const [left, setLeft] = useState(SESSION_END_NOTICE_SECONDS)

  useEffect(() => {
    const timer = window.setInterval(() => setLeft((current) => current - 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (left > 0) return
    leaveToLogin()
  }, [leaveToLogin, left])

  return (
    <main
      className="flex min-h-dvh flex-col overflow-y-auto bg-background px-4 py-6"
      role="alertdialog"
      aria-labelledby="session-ended-title"
      aria-describedby="session-ended-message"
      data-testid="session-ended-notice"
    >
      <section className="mx-auto my-auto grid w-full max-w-md gap-4 rounded-2xl border border-border bg-surface-1 p-6 text-center shadow-md sm:p-8">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-amber-500/25 bg-amber-500/10">
          <MonitorSmartphone className="size-6 text-amber-600" aria-hidden="true" />
        </span>
        <div className="grid gap-2">
          <h1 id="session-ended-title" className="text-xl font-semibold tracking-[-0.015em]">
            {sessionEndTitle(code)}
          </h1>
          <p id="session-ended-message" className="text-sm leading-relaxed text-muted-foreground">
            {message}
          </p>
          {unsaved ? (
            <p className="rounded-xl border border-border-subtle bg-surface-2/80 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {unsaved}
            </p>
          ) : null}
        </div>
        <Button type="button" onClick={leaveToLogin} className="w-full" data-testid="session-ended-login">
          <LogIn className="size-4" aria-hidden="true" /> Đăng nhập lại
        </Button>
        <p
          className="text-xs text-muted-foreground tabular-nums"
          aria-live="polite"
          data-testid="session-ended-countdown"
        >
          {sessionEndCountdownLabel(left)}
        </p>
      </section>
    </main>
  )
}
