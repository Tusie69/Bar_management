export const AUTH_PORTALS = ['admin', 'receptionist', 'customer-care', 'cashier'] as const

export type AuthPortal = typeof AUTH_PORTALS[number]

export const PORTAL_ROLE_CODES: Readonly<Record<AuthPortal, readonly string[]>> = {
  admin: ['OWNER_ADMIN'],
  receptionist: ['RECEPTIONIST'],
  'customer-care': ['CUSTOMER_CARE'],
  cashier: ['CASHIER'],
}

export function isAuthPortal(value: unknown): value is AuthPortal {
  return typeof value === 'string' && (AUTH_PORTALS as readonly string[]).includes(value)
}

export function rolesForPortal(portal: AuthPortal): readonly string[] {
  return PORTAL_ROLE_CODES[portal]
}
