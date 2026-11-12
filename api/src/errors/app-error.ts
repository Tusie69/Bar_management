export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /**
     * Machine-readable context the client acts on, such as the tables that caused
     * a conflict or the capacity a confirmation would override. Never put a phone
     * number, a note or any other customer data here: it is returned verbatim.
     */
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'AppError'
  }
}
