import { z } from 'zod'
import type { PasswordHasher } from './auth.types'

export const PBKDF2_ITERATIONS = 600_000
const SALT_LENGTH = 16
const HASH_LENGTH = 32
const HASH_FORMAT_VERSION = 'pbkdf2-sha256'

const encodedHashSchema = z.tuple([
  z.literal(HASH_FORMAT_VERSION),
  z.string().regex(/^\d+$/),
  z.string().regex(/^[0-9a-f]{32}$/),
  z.string().regex(/^[0-9a-f]{64}$/),
])

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error('Secure cryptographic operations are unavailable')
  }

  return globalThis.crypto
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

function fromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
    if (!Number.isInteger(byte)) {
      throw new Error('Invalid encoded password hash')
    }

    bytes[index] = byte
  }

  return bytes
}

function bytesMatch(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }

  return difference === 0
}

export class Pbkdf2PasswordHasher implements PasswordHasher {
  private readonly iterations: number

  constructor(iterations = PBKDF2_ITERATIONS) {
    if (!Number.isSafeInteger(iterations) || iterations < 600_000) {
      throw new Error('PBKDF2 must use at least 600,000 iterations')
    }

    this.iterations = iterations
  }

  async hash(password: string): Promise<string> {
    if (password.length < 12 || password.length > 128) {
      throw new Error('Password length must be between 12 and 128 characters')
    }

    const cryptoApi = getCrypto()
    const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_LENGTH))
    const derivedKey = await this.derive(password, salt, this.iterations)

    return [
      HASH_FORMAT_VERSION,
      String(this.iterations),
      toHex(salt),
      toHex(derivedKey),
    ].join('$')
  }

  async verify(password: string, encodedHash: string): Promise<boolean> {
    const parsed = encodedHashSchema.safeParse(encodedHash.split('$'))
    if (!parsed.success || password.length > 128) {
      return false
    }

    const [, encodedIterations, encodedSalt, encodedKey] = parsed.data
    const iterations = Number(encodedIterations)
    if (
      !Number.isSafeInteger(iterations) ||
      iterations < 600_000 ||
      iterations > 2_000_000
    ) {
      return false
    }

    const salt = fromHex(encodedSalt)
    const expectedKey = fromHex(encodedKey)
    const actualKey = await this.derive(password, salt, iterations)
    return bytesMatch(actualKey, expectedKey)
  }

  private async derive(
    password: string,
    salt: Uint8Array,
    iterations: number,
  ): Promise<Uint8Array> {
    const cryptoApi = getCrypto()
    const saltBuffer = new ArrayBuffer(salt.byteLength)
    new Uint8Array(saltBuffer).set(salt)
    const keyMaterial = await cryptoApi.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    )
    const derivedBits = await cryptoApi.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: saltBuffer,
        iterations,
      },
      keyMaterial,
      HASH_LENGTH * 8,
    )

    return new Uint8Array(derivedBits)
  }
}
