export class OrganizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrganizationError'
  }
}
