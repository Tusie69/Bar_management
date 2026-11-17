export interface ClipboardWriter {
  writeText: (text: string) => Promise<void>
}

/** Clipboard API policy isolated for deterministic browser/error tests. */
export async function writeBookingExportToClipboard(
  text: string,
  secureContext: boolean,
  clipboard: ClipboardWriter | null | undefined,
): Promise<void> {
  if (!secureContext || !clipboard?.writeText) {
    throw new Error("Clipboard API không khả dụng trong ngữ cảnh hiện tại.")
  }
  await clipboard.writeText(text)
}
