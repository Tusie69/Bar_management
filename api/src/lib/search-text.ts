/** Canonical form stored in *_name_search columns and accepted by reception search. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, (letter) => letter === 'Đ' ? 'D' : 'd')
    .toLowerCase()
    .trim()
}
