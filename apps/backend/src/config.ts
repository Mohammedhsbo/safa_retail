import { z } from 'zod'

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().url().refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'DATABASE_URL must use PostgreSQL',
  ),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default('http://localhost:5173,https://localhost'),
})

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  databaseUrl: string
  jwtSecret: string
  jwtRefreshSecret: string
  corsOrigins: readonly string[]
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(environment)
  if (!parsed.success) {
    throw new Error(`Backend configuration is invalid: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`)
  }
  if (
    parsed.data.NODE_ENV === 'production' &&
    parsed.data.JWT_SECRET === parsed.data.JWT_REFRESH_SECRET
  ) {
    throw new Error('Production access and refresh token secrets must be different')
  }

  const origins = parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  if (parsed.data.NODE_ENV === 'production' && origins.length === 0) {
    throw new Error('CORS_ORIGINS must contain the deployed web origin in production')
  }
  for (const origin of origins) {
    let url: URL
    try {
      url = new URL(origin)
    } catch {
      throw new Error('CORS_ORIGINS must contain exact origins without paths or wildcards')
    }
    if (
      origin.includes('*') ||
      !url.hostname ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      (parsed.data.NODE_ENV === 'production' && url.protocol !== 'https:') ||
      (parsed.data.NODE_ENV !== 'production' && !['https:', 'http:'].includes(url.protocol))
    ) {
      throw new Error('CORS_ORIGINS contains an invalid or insecure origin')
    }
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    jwtSecret: parsed.data.JWT_SECRET,
    jwtRefreshSecret: parsed.data.JWT_REFRESH_SECRET,
    corsOrigins: origins,
  }
}
