import cors from 'cors'
import express, { type ErrorRequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { Prisma } from '@prisma/client'
import type { AppConfig } from './config.js'
import { prisma } from './database.js'
import { HttpError } from './errors.js'
import { AuthenticationService } from './auth/auth.service.js'
import { requireAuthentication } from './auth/auth.middleware.js'
import { createBusinessRouter } from './business-router.js'
import { createAdminRouter } from './admin-router.js'
import {
  AuthenticationError,
  AuthorizationError,
  InitialSetupError,
} from '../../web/src/features/auth/auth.errors.js'
import { AccountingError } from '../../web/src/features/accounting/accounting.errors.js'
import { CatalogError } from '../../web/src/features/catalog/catalog.errors.js'
import { InventoryError } from '../../web/src/features/inventory/inventory.errors.js'
import { ManufacturingError } from '../../web/src/features/manufacturing/manufacturing.errors.js'
import { OrganizationError } from '../../web/src/features/organization/organization.errors.js'
import { PurchasesError } from '../../web/src/features/purchases/purchases.errors.js'
import { ReportsError } from '../../web/src/features/reports/reports.errors.js'
import { SalesError } from '../../web/src/features/sales/sales.errors.js'

const refreshCookie = 'safa_refresh'

function readCookie(request: express.Request, name: string): string | undefined {
  const raw = request.headers.cookie
  if (!raw) return undefined
  for (const pair of raw.split(';')) {
    const separator = pair.indexOf('=')
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}

export function createApp(config: AppConfig) {
  const app = express()
  const authentication = new AuthenticationService(config)
  const authRouter = express.Router()

  if (config.nodeEnv === 'production') app.set('trust proxy', 1)
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'This origin is not allowed'))
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Safa-Restore-Confirmation',
      'X-Safa-Branch-ID',
      'X-Safa-Warehouse-ID',
    ],
  }))
  app.use(express.json({ limit: '1mb' }))
  app.use((request, response, next) => {
    const started = Date.now()
    response.on('finish', () => {
      console.info(JSON.stringify({
        event: 'http.request',
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Date.now() - started,
      }))
    })
    next()
  })

  app.get('/api/v1/health', async (_request, response, next) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      response.status(200).json({ data: { status: 'ok', database: 'connected' } })
    } catch {
      next(new HttpError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable'))
    }
  })

  authRouter.use(rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts' } },
  }))
  authRouter.get('/setup-status', async (_request, response, next) => {
    try {
      response.json({ data: { initialSetupRequired: await authentication.needsInitialOwnerSetup() } })
    } catch (error) {
      next(error)
    }
  })
  authRouter.post('/setup', async (request, response, next) => {
    try {
      const tokens = await authentication.setupInitialOwner(request.body)
      response.cookie(refreshCookie, tokens.refreshToken, cookieOptions(config))
      response.status(201).json({ data: { accessToken: tokens.accessToken, user: tokens.user } })
    } catch (error) {
      next(error)
    }
  })
  authRouter.post('/login', async (request, response, next) => {
    try {
      const tokens = await authentication.login(request.body)
      response.cookie(refreshCookie, tokens.refreshToken, cookieOptions(config))
      response.json({ data: { accessToken: tokens.accessToken, user: tokens.user } })
    } catch (error) {
      next(error)
    }
  })
  authRouter.post('/refresh', async (request, response, next) => {
    try {
      const refreshToken = readCookie(request, refreshCookie)
      if (!refreshToken) throw new HttpError(401, 'INVALID_SESSION', 'The session has expired; sign in again')
      const tokens = await authentication.refresh(refreshToken)
      response.cookie(refreshCookie, tokens.refreshToken, cookieOptions(config))
      response.json({ data: { accessToken: tokens.accessToken, user: tokens.user } })
    } catch (error) {
      next(error)
    }
  })
  authRouter.post('/logout', async (request, response, next) => {
    try {
      await authentication.logout(readCookie(request, refreshCookie))
      response.clearCookie(refreshCookie, cookieOptions(config))
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })
  authRouter.get('/me', requireAuthentication(authentication), (request, response) => {
    response.json({ data: { user: request.principal } })
  })
  authRouter.patch('/me/profile', requireAuthentication(authentication), async (request, response, next) => {
    try {
      if (!request.principal?.permissions.includes('users.manage')) {
        throw new HttpError(403, 'FORBIDDEN', 'Only administrators can update this profile')
      }
      const tokens = await authentication.updateOwnProfile(request.principal.id, request.body)
      response.cookie(refreshCookie, tokens.refreshToken, cookieOptions(config))
      response.json({ data: { accessToken: tokens.accessToken, user: tokens.user } })
    } catch (error) {
      next(error)
    }
  })
  app.use('/api/v1/auth', authRouter)
  app.use('/api/v1', createBusinessRouter(authentication))
  app.use('/api/v1/admin', createAdminRouter(authentication))

  app.use((_request, _response, next) => {
    next(new HttpError(404, 'NOT_FOUND', 'The requested resource was not found'))
  })

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof HttpError) {
      response.status(error.statusCode).json({
        error: { code: error.code, message: error.message },
      })
      return
    }
    if (error instanceof AuthenticationError) {
      response.status(401).json({
        error: { code: 'AUTHENTICATION_FAILED', message: error.message },
      })
      return
    }
    if (error instanceof AuthorizationError) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: error.message },
      })
      return
    }
    if (error instanceof InitialSetupError) {
      response.status(409).json({
        error: { code: 'SETUP_CONFLICT', message: error.message },
      })
      return
    }
    if (
      error instanceof AccountingError ||
      error instanceof CatalogError ||
      error instanceof InventoryError ||
      error instanceof ManufacturingError ||
      error instanceof OrganizationError ||
      error instanceof PurchasesError ||
      error instanceof ReportsError ||
      error instanceof SalesError
    ) {
      response.status(400).json({
        error: { code: 'BUSINESS_RULE_VIOLATION', message: error.message },
      })
      return
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002' || error.code === 'P2003') {
        response.status(409).json({
          error: { code: 'DATA_CONFLICT', message: 'The request conflicts with existing business data' },
        })
        return
      }
      if (error.code === 'P2025') {
        response.status(404).json({
          error: { code: 'RECORD_NOT_FOUND', message: 'The requested record was not found' },
        })
        return
      }
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      (error.type === 'entity.too.large' || error.type === 'entity.parse.failed')
    ) {
      const tooLarge = error.type === 'entity.too.large'
      response.status(tooLarge ? 413 : 400).json({
        error: {
          code: tooLarge ? 'REQUEST_TOO_LARGE' : 'INVALID_JSON',
          message: tooLarge ? 'The request exceeds the supported size limit' : 'The request body is not valid JSON',
        },
      })
      return
    }
    console.error(JSON.stringify({
      event: 'http.error',
      message: error instanceof Error ? error.message : 'Unknown server error',
    }))
    response.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred' },
    })
  }
  app.use(errorHandler)
  return app
}

function cookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' as const : 'lax' as const,
    path: '/api/v1/auth',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  }
}
