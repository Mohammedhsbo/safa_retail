import { z } from 'zod'
import { DatabaseError } from '../errors'
import type { SqlExecutor, SqlRow } from '../types'

const settingSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  value: z.string(),
})

export class ApplicationSettingsRepository {
  private readonly database: SqlExecutor

  constructor(database: SqlExecutor) {
    this.database = database
  }

  async get(key: string): Promise<string | null> {
    const parsedKey = settingSchema.shape.key.safeParse(key)
    if (!parsedKey.success) {
      throw new DatabaseError('Invalid application setting key', {
        cause: parsedKey.error,
      })
    }

    const [row] = await this.database.query(
      'SELECT key, value FROM application_settings WHERE key = ?',
      [parsedKey.data],
    )

    if (!row) {
      return null
    }

    return this.parseSetting(row).value
  }

  async set(key: string, value: string): Promise<void> {
    const parsed = settingSchema.safeParse({ key, value })
    if (!parsed.success) {
      throw new DatabaseError('Invalid application setting', {
        cause: parsed.error,
      })
    }

    await this.database.run(
      `INSERT INTO application_settings (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [parsed.data.key, parsed.data.value, new Date().toISOString()],
    )
  }

  private parseSetting(row: SqlRow) {
    const parsed = settingSchema.safeParse(row)
    if (!parsed.success) {
      throw new DatabaseError('The application setting record is invalid', {
        cause: parsed.error,
      })
    }

    return parsed.data
  }
}
