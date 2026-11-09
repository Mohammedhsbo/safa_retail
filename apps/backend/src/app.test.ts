import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'

const config = {
  nodeEnv: 'test' as const,
  port: 0,
  databaseUrl: 'postgresql://test:test@localhost:5432/test',
  jwtSecret: 'a-test-secret-long-enough-for-the-hmac-key-material',
  jwtRefreshSecret: 'a-different-test-secret-long-enough-for-hmac-key',
  corsOrigins: ['http://localhost:5173', 'https://localhost'],
}

const servers: Array<ReturnType<ReturnType<typeof createApp>['listen']>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  ))
})

async function listen() {
  const server = createApp(config).listen(0)
  servers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port')
  return `http://127.0.0.1:${address.port}`
}

describe('backend HTTP boundary', () => {
  it('returns a consistent unauthorized response for protected endpoints', async () => {
    const response = await fetch(`${await listen()}/api/v1/auth/me`)
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', message: 'A valid access token is required' },
    })
  })

  it('requires authentication before the profile update endpoint', async () => {
    const response = await fetch(`${await listen()}/api/v1/auth/me/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Updated admin' }),
    })
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', message: 'A valid access token is required' },
    })
  })

  it('rejects browser origins not in the CORS allowlist', async () => {
    const response = await fetch(`${await listen()}/api/v1/auth/setup-status`, {
      headers: { Origin: 'https://malicious.example' },
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'ORIGIN_NOT_ALLOWED' },
    })
  })

  it('protects administrative backup endpoints with authentication', async () => {
    const baseUrl = await listen()
    const [schedule, exportBackup, restoreBackup] = await Promise.all([
      fetch(`${baseUrl}/api/v1/admin/backups/schedule`),
      fetch(`${baseUrl}/api/v1/admin/backups/export`, { method: 'POST' }),
      fetch(`${baseUrl}/api/v1/admin/backups/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array([1]),
      }),
    ])
    expect([schedule.status, exportBackup.status, restoreBackup.status]).toEqual([401, 401, 401])
  })

  it('allows the configured Android origin and the restore header in preflight', async () => {
    const baseUrl = await listen()
    const response = await fetch(`${baseUrl}/api/v1/admin/backups/restore`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,x-safa-restore-confirmation',
      },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-credentials')).toBe('true')
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase())
      .toContain('x-safa-restore-confirmation')
  })
})
