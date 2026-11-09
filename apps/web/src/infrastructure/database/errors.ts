export class DatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DatabaseError'
  }
}

export class DatabaseIntegrityError extends DatabaseError {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseIntegrityError'
  }
}
