import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { requireAuthentication } from './auth/auth.middleware.js'
import type { AuthenticationService } from './auth/auth.service.js'
import { createBusinessServices, exposedBusinessOperations } from './business-services.js'
import { HttpError } from './errors.js'
import { prisma } from './database.js'

const branchScopedCatalogOperations = new Set([
  'listProducts',
  'getProduct',
  'getProductByBarcode',
  'createProduct',
  'updateProduct',
  'setProductStatus',
  'archiveProduct',
])

const workspaceRequiredDomains = new Set([
  'catalog',
  'inventory',
  'manufacturing',
  'purchases',
  'reports',
  'sales',
])

function isGlobalBranchAdmin(roleCodes: readonly string[]): boolean {
  return roleCodes.some((role) =>
    ['system_owner', 'general_manager', 'admin'].includes(role),
  )
}

const operationBody = (body: unknown): unknown[] => {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('args' in body) ||
    !Array.isArray(body.args) ||
    body.args.length > 100
  ) {
    throw new HttpError(400, 'INVALID_REQUEST', 'An args array with at most 100 values is required')
  }
  return body.args
}

export function createBusinessRouter(authentication: AuthenticationService) {
  const router = Router()
  const services = createBusinessServices()

  router.use(rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }))
  router.use(requireAuthentication(authentication))
  router.post('/:domain/:operation', async (request, response, next) => {
    try {
      const { domain, operation } = request.params
      if (!domain || !operation || !Object.hasOwn(exposedBusinessOperations, domain)) {
        throw new HttpError(404, 'OPERATION_NOT_FOUND', 'The requested operation was not found')
      }
      const allowed = exposedBusinessOperations[domain as keyof typeof exposedBusinessOperations] as readonly string[]
      if (!allowed.includes(operation)) {
        throw new HttpError(404, 'OPERATION_NOT_FOUND', 'The requested operation was not found')
      }
      const service = services[domain as keyof typeof services]
      const member = Reflect.get(service, operation)
      if (typeof member !== 'function') {
        throw new HttpError(404, 'OPERATION_NOT_FOUND', 'The requested operation was not found')
      }
      const args = operationBody(request.body)
      const workspaceSelectionOperation =
        domain === 'organization' &&
        ['listBranches', 'listAccessibleBranches', 'listWarehouses', 'listAccessibleWarehouses']
          .includes(operation)
      const branchId = workspaceSelectionOperation
        ? null
        : request.header('x-safa-branch-id')?.trim() || null
      const warehouseId = workspaceSelectionOperation
        ? null
        : request.header('x-safa-warehouse-id')?.trim() || null
      const principal = request.principal
      if (!principal) {
        throw new HttpError(401, 'UNAUTHORIZED', 'A valid access token is required')
      }
      if (
        !workspaceSelectionOperation &&
        workspaceRequiredDomains.has(domain) &&
        (!branchId || !warehouseId)
      ) {
        throw new HttpError(
          400,
          'WORKSPACE_REQUIRED',
          'Select an authorized branch and warehouse before accessing this feature',
        )
      }
      if (warehouseId && !branchId) {
        throw new HttpError(400, 'INVALID_WORKSPACE', 'A branch must be selected before a warehouse')
      }
      const globalBranchAdmin = isGlobalBranchAdmin(principal.roleCodes)
      if (branchId) {
        const branch = await prisma.branches.findFirst({
          where: { id: branchId, status: 'active' },
          select: { id: true },
        })
        if (!branch || (!globalBranchAdmin && !principal.branchIds.includes(branchId))) {
          throw new HttpError(403, 'FORBIDDEN', 'The selected branch is not accessible')
        }
      }
      if (warehouseId) {
        const warehouse = await prisma.warehouses.findFirst({
          where: { id: warehouseId, status: 'active', is_active: true },
          select: { id: true, branch_id: true },
        })
        if (
          !warehouse ||
          warehouse.branch_id !== branchId ||
          (!globalBranchAdmin && !principal.warehouseIds.includes(warehouseId))
        ) {
          throw new HttpError(403, 'FORBIDDEN', 'The selected warehouse is not accessible')
        }
      }
      const branchScopedProductOperation =
        domain === 'catalog' && branchScopedCatalogOperations.has(operation)
      if (branchScopedProductOperation && !branchId) {
        throw new HttpError(400, 'WORKSPACE_REQUIRED', 'Select a branch before accessing products')
      }
      const result: unknown = await Reflect.apply(member, service, [
        principal.id,
        ...args.slice(1),
        ...(branchScopedProductOperation && branchId ? [branchId] : []),
      ])
      response.json({
        data: result instanceof Uint8Array
          ? { $binary: Buffer.from(result).toString('base64') }
          : result,
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
