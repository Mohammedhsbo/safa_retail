export class ManufacturingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ManufacturingError'
  }
}
