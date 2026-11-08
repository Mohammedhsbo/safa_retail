import { describe, expect, it } from 'vitest'
import { ApiClient } from '@safa/api-client'

describe('local API URL validation', () => {
  it('allows HTTP for loopback, emulator, and private LAN addresses when explicitly enabled', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.2.2', '192.168.1.20', '172.20.0.10']) {
      expect(() => new ApiClient(`http://${host}:3000/api/v1`, 15_000, true)).not.toThrow()
    }
  })

  it('rejects HTTP for public hosts even when local HTTP is enabled', () => {
    expect(() => new ApiClient('http://retail.example/api/v1', 15_000, true))
      .toThrow(/HTTPS/)
  })

  it('rejects private-network HTTP unless local HTTP is explicitly enabled', () => {
    expect(() => new ApiClient('http://192.168.1.20:3000/api/v1'))
      .toThrow(/HTTPS/)
  })

  it('continues to accept HTTPS API hosts', () => {
    expect(() => new ApiClient('https://retail.example/api/v1')).not.toThrow()
  })
})
