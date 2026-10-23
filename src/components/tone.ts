/** Hues for identity tones (avatars, guest icons). Chosen away from the table-state hues where possible. */
export const TONE_HUES = [300, 200, 350, 265, 130, 30] as const

export function toneFor(key: string | number): number {
  const s = String(key)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return TONE_HUES[h % TONE_HUES.length]
}

/** Up to two initials from a Vietnamese full name: "Đinh Quốc Yến" -> "QY". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase()
}
