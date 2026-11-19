export function normalizePhoneText(value: string): string {
  return value.normalize("NFKC")
}

export function countPhoneDigits(value: string): number {
  const folded = normalizePhoneText(value).replace(/\p{Nd}/gu, "0")
  return folded.match(/[0-9]/g)?.length ?? 0
}
