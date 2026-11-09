import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const productionEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/safa_retail',
  JWT_SECRET: 'access-secret-that-is-at-least-thirty-two-characters',
  JWT_REFRESH_SECRET: 'different-refresh-secret-of-at-least-thirty-two-chars',
  CORS_ORIGINS: 'https://retail.example,https://localhost',
}

describe('backend production configuration', () => {
  it('accepts PostgreSQL, distinct secrets, and exact HTTPS origins', () => {
    expect(loadConfig(productionEnvironment)).toMatchObject({
      nodeEnv: 'production',
      corsOrigins: ['https://retail.example', 'https://localhost'],
    })
  })

  it('rejects insecure, wildcard, or path-based production CORS origins', () => {
    for (const origin of [
      'http://retail.example',
      'https://*.example',
      'https://retail.example/api',
    ]) {
      expect(() => loadConfig({
        ...productionEnvironment,
        CORS_ORIGINS: origin,
      })).toThrow(/CORS_ORIGINS/)
    }
  })

  it('rejects non-PostgreSQL database URLs and reused production signing secrets', () => {
    expect(() => loadConfig({
      ...productionEnvironment,
      DATABASE_URL: 'https://database.example',
    })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({
      ...productionEnvironment,
      JWT_REFRESH_SECRET: productionEnvironment.JWT_SECRET,
    })).toThrow(/must be different/)
  })
})
