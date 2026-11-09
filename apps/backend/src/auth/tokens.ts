import { createHash, randomUUID } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

const accessLifetime = '15m'
const refreshLifetimeSeconds = 30 * 24 * 60 * 60

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createAccessToken(
  userId: string,
  secret: string,
): Promise<string> {
  return new SignJWT({ tokenType: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(accessLifetime)
    .sign(secretKey(secret))
}

export async function createRefreshToken(
  userId: string,
  secret: string,
): Promise<{ token: string; tokenId: string; tokenHash: string; expiresAt: Date }> {
  const jti = randomUUID()
  const expiresAt = new Date(Date.now() + refreshLifetimeSeconds * 1000)
  const token = await new SignJWT({ tokenType: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${refreshLifetimeSeconds}s`)
    .sign(secretKey(secret))
  return { token, tokenId: jti, tokenHash: hashToken(token), expiresAt }
}

export async function verifyToken(
  token: string,
  secret: string,
  type: 'access' | 'refresh',
): Promise<{ userId: string; tokenId?: string }> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    algorithms: ['HS256'],
  })
  if (payload.tokenType !== type || typeof payload.sub !== 'string') {
    throw new Error('Token claims are invalid')
  }
  if (type === 'refresh' && typeof payload.jti !== 'string') {
    throw new Error('Refresh token identifier is missing')
  }
  return {
    userId: payload.sub,
    ...(typeof payload.jti === 'string' ? { tokenId: payload.jti } : {}),
  }
}
