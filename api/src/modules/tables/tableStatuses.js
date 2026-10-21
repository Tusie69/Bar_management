export const TABLE_STATUSES = Object.freeze([
  'AVAILABLE', 'RESERVED', 'OCCUPIED', 'DISABLED', 'BACKUP_INACTIVE',
])

const allowedTransitions = Object.freeze({
  AVAILABLE: ['RESERVED', 'OCCUPIED', 'DISABLED'],
  RESERVED: ['AVAILABLE', 'OCCUPIED', 'DISABLED'],
  OCCUPIED: ['AVAILABLE'],
  DISABLED: ['AVAILABLE'],
  BACKUP_INACTIVE: ['AVAILABLE'],
})

export const isAllowedTransition = (from, to) => from === to || allowedTransitions[from]?.includes(to) === true
