import express, { type NextFunction, type Request, type Response } from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthenticationService } from './auth/auth.service.js'
import { HttpError } from './errors.js'

const mocks = vi.hoisted(() => ({
  listProducts: vi.fn(),
  findBranch: vi.fn(),
  findWarehouse: vi.fn(),
}))

vi.mock('./business-services.js', () => ({
  createBusinessServices: () => ({
    catalog: { listProducts: mocks.listProducts },
  }),
  exposedBusinessOperations: {
    catalog: ['listProducts'],
  },
}))

vi.mock('./database.js', () => ({
  prisma: {
    branches: { findFirst: mocks.findBranch },
    warehouses: { findFirst: mocks.findWarehouse },
  },
}))

vi.mock('./auth/auth.middleware.js', () => ({
  requireAuthentication: () =>
    (request: Request, _response: Response, next: NextFunction) => {
      Object.assign(request, {
        principal: {
          id: 'user-id',
          username: 'operator',
          displayName: 'Operator',
          roleCodes: ['branch_manager'],
          permissions: ['products.read'],
          branchIds: ['branch-id'],
          warehouseIds: ['warehouse-id'],
        },
      })
      next()
    },
}))

import { createBusinessRouter } from './business-router.js'

const servers: Array<ReturnType<ReturnType<typeof express>['listen']>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  ))
  vi.clearAllMocks()
})

async function listen() {
  const app = express()
  app.use(express.json())
  app.use(createBusinessRouter({} as AuthenticationService))
  app.use((
    error: unknown,
    _request: Request,
    response: Response,
    _next: NextFunction,
  ) => {
    if (error instanceof HttpError) {
      response.status(error.statusCode).json({
        error: { code: error.code, message: error.message },
      })
      return
    }
    response.status(500).json({ error: { code: 'INTERNAL_ERROR' } })
  })
  const server = app.listen(0)
  servers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind a TCP port')
  }
  return `http://127.0.0.1:${address.port}`
}

async function requestProducts(
  baseUrl: string,
  workspaceHeaders: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/catalog/listProducts`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      ...workspaceHeaders,
    },
    body: JSON.stringify({ args: ['user-id'] }),
  })
}

describe('business API workspace selection', () => {
  it('requires both branch and warehouse context before operational requests', async () => {
    const baseUrl = await listen()
    const noWorkspace = await requestProducts(baseUrl)
    const branchOnly = await requestProducts(baseUrl, {
      'X-Safa-Branch-ID': 'branch-id',
    })

    expect(noWorkspace.status).toBe(400)
    await expect(noWorkspace.json()).resolves.toMatchObject({
      error: { code: 'WORKSPACE_REQUIRED' },
    })
    expect(branchOnly.status).toBe(400)
    await expect(branchOnly.json()).resolves.toMatchObject({
      error: { code: 'WORKSPACE_REQUIRED' },
    })
    expect(mocks.listProducts).not.toHaveBeenCalled()
  })

  it('accepts a selected branch and an active warehouse in that branch', async () => {
    mocks.findBranch.mockResolvedValue({ id: 'branch-id' })
    mocks.findWarehouse.mockResolvedValue({
      id: 'warehouse-id',
      branch_id: 'branch-id',
    })
    mocks.listProducts.mockResolvedValue([])
    const response = await requestProducts(await listen(), {
      'X-Safa-Branch-ID': 'branch-id',
      'X-Safa-Warehouse-ID': 'warehouse-id',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data: [] })
    expect(mocks.listProducts).toHaveBeenCalledWith('user-id', 'branch-id')
  })

  it('rejects a selected warehouse that belongs to a different branch', async () => {
    mocks.findBranch.mockResolvedValue({ id: 'branch-id' })
    mocks.findWarehouse.mockResolvedValue({
      id: 'warehouse-id',
      branch_id: 'other-branch',
    })
    const response = await requestProducts(await listen(), {
      'X-Safa-Branch-ID': 'branch-id',
      'X-Safa-Warehouse-ID': 'warehouse-id',
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    })
    expect(mocks.listProducts).not.toHaveBeenCalled()
  })
})
