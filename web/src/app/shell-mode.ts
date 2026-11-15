import type { RoleCode } from "@/domain/enums"

/**
 * NA-38: Receptionist uses the MobileApp reception experience at ALL viewport widths.
 * Every other role keeps the 768px mobile/desktop shell split.
 */
export function shouldUseMobileShell(role: RoleCode, isMobile: boolean): boolean {
  return role === "RECEPTIONIST" || isMobile
}
