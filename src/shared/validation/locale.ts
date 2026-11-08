import { z } from 'zod'

export const localeSchema = z.enum(['ar', 'en'])
export type Locale = z.infer<typeof localeSchema>
