import { pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'

const pbkdf2 = promisify(pbkdf2Callback)
const iterations = 600_000
const saltLength = 16
const keyLength = 32
const storedHashSchema = z.tuple([
  z.literal('pbkdf2-sha256'),
  z.string().regex(/^\d+$/),
  z.string().regex(/^[0-9a-f]{32}$/),
  z.string().regex(/^[0-9a-f]{64}$/),
])

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 128) {
    throw new Error('Password length must be between 12 and 128 characters')
  }
  const salt = randomBytes(saltLength)
  const hash = await pbkdf2(password, salt, iterations, keyLength, 'sha256')
  return `pbkdf2-sha256$${iterations}$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parsed = storedHashSchema.safeParse(storedHash.split('$'))
  if (!parsed.success || password.length > 128) return false
  const [, roundText, saltText, hashText] = parsed.data
  const rounds = Number(roundText)
  if (!Number.isSafeInteger(rounds) || rounds < iterations || rounds > 2_000_000) {
    return false
  }
  const expected = Buffer.from(hashText, 'hex')
  const actual = await pbkdf2(password, Buffer.from(saltText, 'hex'), rounds, expected.length, 'sha256')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
