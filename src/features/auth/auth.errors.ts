export class AuthenticationError extends Error {
  constructor(message = 'Invalid username or password') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export class AuthorizationError extends Error {
  constructor(message = 'The current user is not authorized to perform this action') {
    super(message)
    this.name = 'AuthorizationError'
  }
}

export class InitialSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InitialSetupError'
  }
}
