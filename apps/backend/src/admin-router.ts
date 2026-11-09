import express, { Router } from 'express'
import { requireAuthentication } from './auth/auth.middleware.js'
import { rateLimit } from 'express-rate-limit'
import type { AuthenticationService } from './auth/auth.service.js'
import { prisma } from './database.js'
import { HttpError } from './errors.js'
import { PostgresBackupService } from './postgres-backup.service.js'

export function createAdminRouter(authentication: AuthenticationService) {
  const router = Router()
  const backups = new PostgresBackupService()
  router.use(requireAuthentication(authentication))
  router.use((request, _response, next) => {
    if (!request.principal?.permissions.includes('settings.manage')) {
      next(new HttpError(403, 'FORBIDDEN', 'Settings management permission is required'))
      return
    }
    next()
  })
  const backupRateLimit = rateLimit({
    windowMs: 60_000,
    limit: 6,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  })

  router.get('/audit-logs', async (_request, response, next) => {
    try {
      const entries = await prisma.audit_logs.findMany({
        select: {
          action: true,
          entity_type: true,
          entity_id: true,
          occurred_at: true,
        },
        orderBy: { occurred_at: 'desc' },
        take: 100,
      })
      response.json({ data: entries })
    } catch (error) {
      next(error)
    }
  })

  router.get('/database-health', async (_request, response, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      const constraints = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM pg_constraint
        WHERE contype = 'f' AND NOT convalidated
      `
      response.json({
        data: {
          integrity: 'ok',
          foreignKeyIssues: Number(constraints[0]?.count ?? 0),
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/backups/schedule', backupRateLimit, async (_request, response, next) => {
    try {
      response.json({ data: await backups.getSchedule() })
    } catch (error) {
      next(error)
    }
  })

  router.put('/backups/schedule', backupRateLimit, async (request, response, next) => {
    try {
      response.json({ data: await backups.setSchedule(request.body) })
    } catch (error) {
      next(error)
    }
  })

  router.post('/backups/export', backupRateLimit, async (_request, response, next) => {
    try {
      const bytes = await backups.createBackup()
      response.json({ data: { $binary: Buffer.from(bytes).toString('base64') } })
    } catch (error) {
      next(error)
    }
  })

  const readBackupFile = express.raw({
    type: 'application/octet-stream',
    limit: '256mb',
  })

  router.post('/backups/preview', backupRateLimit, readBackupFile, async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body)) {
        throw new HttpError(400, 'INVALID_BACKUP', 'A binary backup file is required')
      }
      response.json({ data: await backups.previewBackup(request.body) })
    } catch (error) {
      next(error)
    }
  })

  router.post('/backups/restore', backupRateLimit, readBackupFile, async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body)) {
        throw new HttpError(400, 'INVALID_BACKUP', 'A binary backup file is required')
      }
      const confirmed = request.header('x-safa-restore-confirmation') === 'true'
      const actorId = request.principal?.id
      if (!actorId) throw new HttpError(401, 'UNAUTHORIZED', 'A valid access token is required')
      response.json({ data: await backups.restoreBackup(request.body, confirmed, actorId) })
    } catch (error) {
      next(error)
    }
  })
  return router
}
