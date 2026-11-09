export class SalesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SalesError'
  }
}
