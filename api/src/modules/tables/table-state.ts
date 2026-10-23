export const tableStates = ['AVAILABLE', 'RESERVED', 'IN_USE'] as const
export type TableState = (typeof tableStates)[number]

const allowedTransitions: Readonly<Record<TableState, readonly TableState[]>> = {
  AVAILABLE: ['RESERVED', 'IN_USE'],
  RESERVED: ['AVAILABLE', 'IN_USE'],
  IN_USE: ['AVAILABLE'],
}

export function isTableState(value: unknown): value is TableState {
  return typeof value === 'string' && tableStates.includes(value as TableState)
}

export function canTransitionTableState(from: TableState, to: TableState): boolean {
  return from === to || allowedTransitions[from].includes(to)
}

