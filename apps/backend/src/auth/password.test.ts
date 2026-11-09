import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

describe('backend password hashes', () => {
  it('uses the hash format compatible with existing local accounts', async () => {
    const encoded = await hashPassword('a sufficiently long password')
    expect(encoded).toMatch(/^pbkdf2-sha256\$600000\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    await expect(verifyPassword('a sufficiently long password', encoded)).resolves.toBe(true)
    await expect(verifyPassword('a different long password', encoded)).resolves.toBe(false)
  })

  it('rejects invalid hashes and out-of-policy passwords', async () => {
    await expect(verifyPassword('anything long enough', 'not-a-hash')).resolves.toBe(false)
    await expect(hashPassword('short')).rejects.toThrow(/between 12 and 128/)
  })
})
