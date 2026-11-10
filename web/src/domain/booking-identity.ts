/**
 * WF-01 — what the booking editor may send for the guest name.
 *
 * A booking with no name of its own is displayed through a fallback ("Khách").
 * The editor used to seed its input with that fallback and always send it as
 * `contactName`, so a receptionist who only changed the note turned the
 * fallback into a real stored name and destroyed the phone-only identity.
 *
 * The decision is made from the identity flag the API already reports, never by
 * comparing the text to the fallback: a guest really called "Khách" must keep
 * that name like anyone else.
 *
 *   - something typed            -> send it, even if it equals the fallback;
 *   - empty, booking had a name  -> an intentional clear, send "";
 *   - empty, booking had none    -> omit the field, so the identity is untouched.
 *
 * Omitting is what the HTTP adapter's `fullUpdateBookingPayload` already expects
 * for "leave the name as it is".
 */

/** The name input's initial value: never the display fallback. */
export function initialContactName(hasGuestName: boolean, displayName: string): string {
  return hasGuestName ? displayName : ""
}

/**
 * The `contactName` part of an update payload, or nothing when the booking has
 * no name and the user did not give one.
 */
export function contactNameUpdate(
  hasGuestName: boolean,
  input: string,
): { contactName: string } | Record<string, never> {
  if (input.trim()) return { contactName: input }
  return hasGuestName ? { contactName: "" } : {}
}

export function formatHonorificName(name: string, honorific?: "MR" | "MS" | null): string {
  if (honorific === "MR") return `Mr ${name}`
  if (honorific === "MS") return `Ms ${name}`
  return name
}
