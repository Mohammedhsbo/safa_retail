import type {
  ApiEnvelope,
  ApiErrorEnvelope,
  AuthResponse,
  AuthenticatedUser,
} from '@safa/types'

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some((octet) => octet < 0 || octet > 255)) return false
  const [first, second] = octets
  if (first === undefined || second === undefined) return false
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '10.0.2.2' ||
    isPrivateIpv4(hostname)
}

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'ApiError'
  }

  get isConnectionError(): boolean {
    return this.status === 0 || this.status >= 500
  }
}

export class ApiClient {
  readonly baseUrl: string
  private accessToken: string | null = null
  private branchId: string | null = null
  private warehouseId: string | null = null
  private refreshInFlight: Promise<AuthResponse | null> | null = null
  private readonly timeoutMs: number

  constructor(baseUrl: string, timeoutMs = 15_000, allowInsecureHttp = false) {
    const normalized = baseUrl.trim().replace(/\/+$/, '')
    if (!normalized) throw new Error('API base URL is required')
    let url: URL
    try {
      url = new URL(normalized)
    } catch {
      throw new Error('API base URL must be a valid absolute URL')
    }
    if (
      url.protocol !== 'https:' &&
      !(allowInsecureHttp && isLocalDevelopmentHost(url.hostname))
    ) {
      throw new Error('API base URL must use HTTPS outside local development')
    }
    this.baseUrl = normalized
    this.timeoutMs = timeoutMs
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token
  }

  setWorkspace(branchId: string | null, warehouseId: string | null): void {
    this.branchId = branchId
    this.warehouseId = warehouseId
  }

  async health(): Promise<{ status: string; database: string }> {
    return this.request('/api/v1/health')
  }

  async setupStatus(): Promise<{ initialSetupRequired: boolean }> {
    return this.request('/api/v1/auth/setup-status')
  }

  async restoreSession(): Promise<AuthResponse | null> {
    try {
      const result = await this.request<AuthResponse>(
        '/api/v1/auth/refresh',
        { method: 'POST' },
        false,
      )
      this.accessToken = result.accessToken
      return result
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null
      throw error
    }
  }

  async setup(input: { username: string; password: string; displayName: string }): Promise<AuthResponse> {
    return this.authenticate('/api/v1/auth/setup', input)
  }

  async login(input: { username: string; password: string }): Promise<AuthResponse> {
    return this.authenticate('/api/v1/auth/login', input)
  }

  async currentUser(): Promise<AuthenticatedUser> {
    const response = await this.request<{ user: AuthenticatedUser }>('/api/v1/auth/me')
    return response.user
  }

  async updateOwnProfile(input: {
    displayName: string
    currentPassword?: string
    newPassword?: string
  }): Promise<AuthResponse> {
    const result = await this.request<AuthResponse>('/api/v1/auth/me/profile', {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
    this.accessToken = result.accessToken
    return result
  }

  async logout(): Promise<void> {
    await this.request<void>('/api/v1/auth/logout', { method: 'POST' }, false)
    this.accessToken = null
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
    allowRefresh = true,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const response = await this.send(path, init, timeoutMs)
    if (response.status === 401 && allowRefresh && this.accessToken && path !== '/api/v1/auth/refresh') {
      const refreshed = await this.refresh()
      if (refreshed) return this.request<T>(path, init, false, timeoutMs)
    }
    if (!response.ok) throw await this.toApiError(response)
    if (response.status === 204) return undefined as T
    const envelope = await this.parseJson<ApiEnvelope<T>>(response)
    return this.decodeBinary(envelope.data) as T
  }

  async upload<T>(path: string, file: File | Blob, fieldName = 'file'): Promise<T> {
    const form = new FormData()
    form.append(fieldName, file)
    return this.request<T>(path, { method: 'POST', body: form })
  }

  async uploadBytes<T>(
    path: string,
    bytes: Uint8Array,
    headers: HeadersInit = {},
    timeoutMs = 600_000,
  ): Promise<T> {
    const body = bytes.slice().buffer as ArrayBuffer
    return this.request<T>(path, {
      method: 'POST',
      headers: { ...Object.fromEntries(new Headers(headers)), 'Content-Type': 'application/octet-stream' },
      body,
    }, true, timeoutMs)
  }

  private async authenticate(
    path: string,
    input: Record<string, string>,
  ): Promise<AuthResponse> {
    const result = await this.request<AuthResponse>(path, {
      method: 'POST',
      body: JSON.stringify(input),
    }, false)
    this.accessToken = result.accessToken
    return result
  }

  private async refresh(): Promise<AuthResponse | null> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.request<AuthResponse>(
        '/api/v1/auth/refresh',
        { method: 'POST' },
        false,
      ).then((result) => {
        this.accessToken = result.accessToken
        return result
      }).catch(() => {
        this.accessToken = null
        return null
      }).finally(() => {
        this.refreshInFlight = null
      })
    }
    return this.refreshInFlight
  }

  private async send(path: string, init: RequestInit, timeoutMs = this.timeoutMs): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const headers = new Headers(init.headers)
    if (this.accessToken) {
      headers.set('Authorization', `Bearer ${this.accessToken}`)
    }
    if (this.branchId) headers.set('X-Safa-Branch-ID', this.branchId)
    else headers.delete('X-Safa-Branch-ID')
    if (this.warehouseId) headers.set('X-Safa-Warehouse-ID', this.warehouseId)
    else headers.delete('X-Safa-Warehouse-ID')
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    try {
      const response = await fetch(new URL(path, `${this.baseUrl}/`), {
        ...init,
        headers,
        credentials: 'include',
        signal: controller.signal,
      })
      window.dispatchEvent(new CustomEvent('safa:connectivity', {
        detail: { connected: response.status < 500 },
      }))
      return response
    } catch (error) {
      window.dispatchEvent(new CustomEvent('safa:connectivity', {
        detail: { connected: false },
      }))
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? 'The server request timed out'
        : 'The server could not be reached. Check the internet connection and try again.'
      throw new ApiError(0, 'CONNECTION_ERROR', message)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async parseJson<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T
    } catch {
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an invalid response')
    }
  }

  private async toApiError(response: Response): Promise<ApiError> {
    try {
      const body = await response.json() as ApiErrorEnvelope
      return new ApiError(
        response.status,
        body.error?.code ?? 'REQUEST_FAILED',
        body.error?.message ?? 'The server rejected the request',
      )
    } catch {
      return new ApiError(response.status, 'REQUEST_FAILED', 'The server rejected the request')
    }
  }

  private decodeBinary<T>(value: T): T | Uint8Array {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('$binary' in value) ||
      typeof value.$binary !== 'string'
    ) return value
    const decoded = atob(value.$binary)
    const bytes = new Uint8Array(decoded.length)
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index)
    }
    return bytes
  }
}
