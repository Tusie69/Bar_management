/**
 * Group symbols for combined tables (TH §3, NAM_CONFIRMED).
 * Every table in one group shows the same symbol; concurrent groups show
 * different symbols. table_groups.symbol_no = the smallest free number for
 * the business date, up to venues.group_symbol_count (default 12).
 *
 * Paths are drawn in a 16x16 box centred on (8, 8).
 */
export interface GroupSymbol {
  no: number
  name: string
  path: string
  fill: boolean
}

export const GROUP_SYMBOLS: GroupSymbol[] = [
  {
    no: 1,
    name: "Nơ",
    fill: true,
    path: "M8 8 L2.5 4.2 Q1.6 3.8 1.6 4.8 V11.2 Q1.6 12.2 2.5 11.8 Z M8 8 L13.5 4.2 Q14.4 3.8 14.4 4.8 V11.2 Q14.4 12.2 13.5 11.8 Z M6.6 6.6 H9.4 V9.4 H6.6 Z",
  },
  {
    no: 2,
    name: "Sao",
    fill: true,
    path: "M8 1.4 L9.9 5.6 L14.5 6 L11 9 L12.1 13.6 L8 11.2 L3.9 13.6 L5 9 L1.5 6 L6.1 5.6 Z",
  },
  { no: 3, name: "Thoi", fill: true, path: "M8 1.5 L13.2 8 L8 14.5 L2.8 8 Z" },
  { no: 4, name: "Tròn", fill: true, path: "M8 2.5 A5.5 5.5 0 1 1 7.99 2.5 Z" },
  { no: 5, name: "Tam giác", fill: true, path: "M8 2 L14 13.2 H2 Z" },
  { no: 6, name: "Vuông", fill: true, path: "M3 3 H13 V13 H3 Z" },
  {
    no: 7,
    name: "Tim",
    fill: true,
    path: "M8 13.8 L2.6 8.4 Q0.8 6.4 2.4 4.2 Q4.6 2 8 5 Q11.4 2 13.6 4.2 Q15.2 6.4 13.4 8.4 Z",
  },
  { no: 8, name: "Lục giác", fill: true, path: "M8 1.8 L13.4 4.9 V11.1 L8 14.2 L2.6 11.1 V4.9 Z" },
  { no: 9, name: "Chữ thập", fill: true, path: "M6.2 2 H9.8 V6.2 H14 V9.8 H9.8 V14 H6.2 V9.8 H2 V6.2 H6.2 Z" },
  { no: 10, name: "Trăng", fill: true, path: "M10.5 2.2 A6 6 0 1 0 13.8 11.2 A5 5 0 1 1 10.5 2.2 Z" },
  { no: 11, name: "Giọt", fill: true, path: "M8 1.6 Q13 7.6 13 10 A5 5 0 0 1 3 10 Q3 7.6 8 1.6 Z" },
  { no: 12, name: "Tia", fill: true, path: "M9.4 1.5 L3.5 9.2 H7.6 L6.6 14.5 L12.5 6.8 H8.4 Z" },
]

export function symbolByNo(no: number | null | undefined): GroupSymbol | null {
  if (!no) return null
  return GROUP_SYMBOLS.find((s) => s.no === no) ?? null
}
