function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  )
}

/**
 * Điều phối chốt đồng bộ (chống nhấp đúp / Enter lặp) và mở khóa / đóng hộp
 * theo tín hiệu hoàn tất của chính lượt gửi (promise hoặc chu kỳ `busy`).
 */
export interface ApproveConfirmTracker {
  isLocked: () => boolean
  setMounted: (mounted: boolean) => void
  sync: (state: { open: boolean; busy: boolean }) => void
  consumeReadyToClose: () => boolean
  submit: (onConfirm: () => unknown, onSettled: () => void) => boolean
}

export function createApproveConfirmTracker(): ApproveConfirmTracker {
  let mounted = true
  let open = false
  let busy = false
  let submitting = false
  let wasBusy = false
  let settledWhileBusy = false
  let attemptId = 0

  function clearAttemptFlags() {
    wasBusy = false
    settledWhileBusy = false
    submitting = false
  }

  return {
    isLocked: () => busy || submitting,
    setMounted: (nextMounted) => {
      mounted = nextMounted
      if (!nextMounted) attemptId += 1
    },
    sync: (state) => {
      open = state.open
      busy = state.busy
      if (!state.open) {
        attemptId += 1
        clearAttemptFlags()
        return
      }
      if (state.busy) {
        wasBusy = true
      }
    },
    consumeReadyToClose: () => {
      if (!open || busy || (!wasBusy && !settledWhileBusy)) return false
      clearAttemptFlags()
      return true
    },
    submit: (onConfirm, onSettled) => {
      if (!open || busy || submitting) return false
      submitting = true
      settledWhileBusy = false
      const currentAttempt = ++attemptId

      let result: unknown
      try {
        result = onConfirm()
      } catch {
        clearAttemptFlags()
        onSettled()
        return true
      }

      if (isThenable(result)) {
        const handleSettled = () => {
          if (!mounted || !open || attemptId !== currentAttempt) return
          if (!busy) {
            clearAttemptFlags()
            onSettled()
            return
          }
          settledWhileBusy = true
        }
        Promise.resolve(result).then(handleSettled, handleSettled)
      }
      return true
    },
  }
}
