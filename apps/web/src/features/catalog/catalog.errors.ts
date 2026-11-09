export class CatalogError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogError'
  }
}
