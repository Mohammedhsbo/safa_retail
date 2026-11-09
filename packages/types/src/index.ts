export type AuthenticatedUser = {
  id: string
  username: string
  displayName: string
  roleCodes: readonly string[]
  permissions: readonly string[]
  branchIds: readonly string[]
  warehouseIds: readonly string[]
}

export type ApiEnvelope<T> = { data: T }

export type ApiErrorEnvelope = {
  error: {
    code: string
    message: string
  }
}

export type AuthResponse = {
  accessToken: string
  user: AuthenticatedUser
}
