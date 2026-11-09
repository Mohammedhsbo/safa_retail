export class PurchasesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PurchasesError'
  }
}
