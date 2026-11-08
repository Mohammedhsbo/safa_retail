import { z } from 'zod'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase, SqlExecutor, SqlRow } from '../../infrastructure/database/types'
import { AccessControlService } from '../auth/AccessControlService'
import { AuthRepository } from '../auth/AuthRepository'
import { AuthorizationError } from '../auth/auth.errors'
import { InventoryError } from './inventory.errors'
import { InventoryRepository } from './InventoryRepository'
import {
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  quantityWithinPrecision,
} from './decimal'

const uuidSchema = z.string().uuid()
const quantitySchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
const costSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
const adjustmentSchema = z.object({
  productId: uuidSchema,
  warehouseId: uuidSchema,
  unitId: uuidSchema,
  quantity: quantitySchema,
  direction: z.enum(['in', 'out']),
  reasonType: z.enum(['correction', 'damage', 'missing']).default('correction'),
  unitCost: costSchema.optional(),
  reason: z.string().trim().min(2).max(500),
})
const transferInputSchema = z.object({
  fromWarehouseId: uuidSchema,
  toWarehouseId: uuidSchema,
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(
    z.object({
      productId: uuidSchema,
      unitId: uuidSchema,
      quantity: quantitySchema,
    }),
  ).min(1).max(500),
})
const countInputSchema = z.object({
  warehouseId: uuidSchema,
  productIds: z.array(uuidSchema).min(1).max(500),
})
const countEntrySchema = z.object({
  productId: uuidSchema,
  unitId: uuidSchema,
  countedQuantity: quantitySchema,
  notes: z.string().trim().max(500).nullable().optional(),
})
const historyQuerySchema = z.object({
  warehouseId: uuidSchema,
  productId: uuidSchema.nullable().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).max(1_000_000).default(0),
})

export type InventoryBalance = {
  productId: string
  sku: string
  productName: string
  baseUnitId: string
  warehouseId: string
  quantity: string
  averageUnitCost: string
  inventoryValue: string
  updatedAt: string | null
}

export type InventoryMovement = {
  id: string
  productId: string
  sku: string
  productName: string
  warehouseId: string
  movementType: string
  quantity: string
  unitId: string
  unitCost: string
  sourceType: string
  sourceId: string
  occurredAt: string
  createdBy: string | null
}

export type StockTransfer = {
  id: string
  transferNumber: string
  fromBranchId: string
  fromWarehouseId: string
  toBranchId: string
  toWarehouseId: string
  status: string
  notes: string | null
  requestedBy: string
  approvedBy: string | null
  receivedBy: string | null
  createdAt: string
  updatedAt: string
  items: Array<{
    id: string
    productId: string
    unitId: string
    quantity: string
    receivedQuantity: string | null
  }>
}

export type StockCount = {
  id: string
  countNumber: string
  warehouseId: string
  status: string
  countedBy: string | null
  approvedBy: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  items: Array<{
    id: string
    productId: string
    expectedQuantity: string
    countedQuantity: string | null
    unitId: string
    notes: string | null
  }>
}

type NormalizedInput = {
  productId: string
  baseUnitId: string
  baseQuantity: bigint
  baseQuantityText: string
}

export class InventoryService {
  private readonly database: SqlDatabase
  private readonly access: AccessControlService
  private readonly authRepository: AuthRepository
  private readonly repository: InventoryRepository

  constructor(database: SqlDatabase) {
    this.database = database
    this.access = new AccessControlService(database)
    this.authRepository = new AuthRepository(database)
    this.repository = new InventoryRepository(database)
  }

  async adjustStock(actorId: string, input: unknown): Promise<string> {
    const parsed = adjustmentSchema.safeParse(input)
    if (!parsed.success) {
      throw new InventoryError('The stock adjustment details are invalid')
    }

    const quantity = parseDecimal(parsed.data.quantity, 'Quantity')
    if (quantity <= 0n) {
      throw new InventoryError('Adjustment quantity must be greater than zero')
    }
    if (parsed.data.direction === 'in' && parsed.data.unitCost === undefined) {
      throw new InventoryError(
        'An incoming adjustment requires an explicit unit cost',
      )
    }
    if (
      parsed.data.direction === 'in' &&
      parsed.data.reasonType !== 'correction'
    ) {
      throw new InventoryError(
        'Damage and missing stock can only be recorded as outgoing adjustments',
      )
    }

    const movementId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const location = await this.assertWarehousePermission(
        actorId,
        'inventory.adjust',
        parsed.data.warehouseId,
        transaction,
      )
      const normalized = await this.normalizeQuantity(
        parsed.data.productId,
        parsed.data.unitId,
        parsed.data.quantity,
        transaction,
      )
      if (parsed.data.direction === 'in') {
        const unit = await this.getProductUnit(
          parsed.data.productId,
          parsed.data.unitId,
          transaction,
        )
        const inputCost = parseDecimal(parsed.data.unitCost!, 'Unit cost')
        const unitCostBase = divideDecimal(
          inputCost,
          parseDecimal(unit.factor_to_base, 'Unit conversion factor'),
        )
        await this.applyIncrease(
          actorId,
          parsed.data.warehouseId,
          normalized,
          unitCostBase,
          'adjustment_in',
          'manual_adjustment',
          movementId,
          now,
          transaction,
          movementId,
        )
      } else {
        await this.applyDecrease(
          actorId,
          parsed.data.warehouseId,
          normalized,
          parsed.data.reasonType === 'damage'
            ? 'damaged_out'
            : parsed.data.reasonType === 'missing'
              ? 'missing_out'
              : 'adjustment_out',
          'manual_adjustment',
          movementId,
          now,
          transaction,
          movementId,
        )
      }

      await this.writeAudit(
        transaction,
        actorId,
        'inventory.adjusted',
        'inventory_movement',
        movementId,
        null,
        {
          productId: parsed.data.productId,
          warehouseId: parsed.data.warehouseId,
          branchId: location.branchId,
          quantity: normalized.baseQuantityText,
          unitId: normalized.baseUnitId,
          direction: parsed.data.direction,
          reasonType: parsed.data.reasonType,
          reason: parsed.data.reason,
        },
        now,
      )
    })
    return movementId
  }

  async getBalance(
    actorId: string,
    warehouseId: string,
    productId: string,
  ): Promise<InventoryBalance> {
    if (!uuidSchema.safeParse(productId).success) {
      throw new InventoryError('The product identifier is invalid')
    }
    await this.assertWarehousePermission(
      actorId,
      'inventory.read',
      warehouseId,
      this.database,
    )
    const product = await this.requireActiveProduct(productId, this.database)
    const balance = await this.repository.getBalance(
      productId,
      warehouseId,
    )
    return {
      productId,
      sku: this.rowString(product.sku),
      productName: this.rowString(product.name),
      baseUnitId: this.rowString(product.base_unit_id),
      warehouseId,
      quantity: balance.quantity,
      averageUnitCost: balance.averageUnitCost,
      inventoryValue: formatDecimal(
        multiplyDecimal(
          parseDecimal(balance.quantity, 'Balance quantity'),
          parseDecimal(balance.averageUnitCost, 'Average unit cost'),
        ),
      ),
      updatedAt: balance.updatedAt,
    }
  }

  async listBalances(
    actorId: string,
    warehouseId: string,
  ): Promise<InventoryBalance[]> {
    await this.assertWarehousePermission(
      actorId,
      'inventory.read',
      warehouseId,
      this.database,
    )
    const rows = await this.repository.listBalances(warehouseId)
    return rows.map((row) => {
      const quantity = this.rowString(row.on_hand_quantity)
      const averageUnitCost = this.rowString(row.average_unit_cost)
      return {
        productId: this.rowString(row.product_id),
        sku: this.rowString(row.sku),
        productName: this.rowString(row.name),
        baseUnitId: this.rowString(row.base_unit_id),
        warehouseId,
        quantity,
        averageUnitCost,
        inventoryValue: formatDecimal(
          multiplyDecimal(
            parseDecimal(quantity, 'Balance quantity'),
            parseDecimal(averageUnitCost, 'Average unit cost'),
          ),
        ),
        updatedAt: this.rowString(row.updated_at),
      }
    })
  }

  async listMovements(
    actorId: string,
    input: unknown,
  ): Promise<InventoryMovement[]> {
    const parsed = historyQuerySchema.safeParse(input)
    if (!parsed.success) {
      throw new InventoryError('The inventory history filter is invalid')
    }
    await this.assertWarehousePermission(
      actorId,
      'inventory.read',
      parsed.data.warehouseId,
      this.database,
    )
    const rows = await this.repository.listMovements(
      parsed.data.warehouseId,
      parsed.data.productId ?? null,
      parsed.data.limit,
      parsed.data.offset,
    )
    return rows.map((row) => ({
      id: this.rowString(row.id),
      productId: this.rowString(row.product_id),
      sku: this.rowString(row.sku),
      productName: this.rowString(row.name),
      warehouseId: this.rowString(row.warehouse_id),
      movementType: this.rowString(row.movement_type),
      quantity: this.rowString(row.quantity),
      unitId: this.rowString(row.unit_id),
      unitCost: this.rowString(row.unit_cost),
      sourceType: this.rowString(row.source_type),
      sourceId: this.rowString(row.source_id),
      occurredAt: this.rowString(row.occurred_at),
      createdBy:
        typeof row.created_by === 'string' ? row.created_by : null,
    }))
  }

  async postPurchaseReceipt(
    actorId: string,
    warehouseId: string,
    purchaseId: string,
    items: Array<{
      productId: string
      unitId: string
      quantity: string
      unitCost: string
    }>,
    executor: SqlExecutor,
  ): Promise<void> {
    await this.access.assertPermission(actorId, 'purchases.create', executor)
    await this.assertWarehouseScope(actorId, warehouseId, executor)
    const now = new Date().toISOString()
    for (const item of items) {
      const normalized = await this.normalizeQuantity(
        item.productId,
        item.unitId,
        item.quantity,
        executor,
      )
      const unit = await this.getProductUnit(
        item.productId,
        item.unitId,
        executor,
      )
      const unitCostBase = divideDecimal(
        parseDecimal(item.unitCost, 'Purchase unit cost'),
        parseDecimal(unit.factor_to_base, 'Unit conversion factor'),
      )
      await this.applyIncrease(
        actorId,
        warehouseId,
        normalized,
        unitCostBase,
        'purchase_in',
        'purchase',
        purchaseId,
        now,
        executor,
      )
    }
  }

  async postPurchaseReturnOutbound(
    actorId: string,
    warehouseId: string,
    returnId: string,
    items: Array<{ productId: string; unitId: string; quantity: string }>,
    executor: SqlExecutor,
  ): Promise<void> {
    await this.access.assertPermission(actorId, 'purchases.returns', executor)
    await this.assertWarehouseScope(actorId, warehouseId, executor)
    const now = new Date().toISOString()
    for (const item of items) {
      const normalized = await this.normalizeQuantity(
        item.productId,
        item.unitId,
        item.quantity,
        executor,
        false,
        true,
      )
      await this.applyDecrease(
        actorId,
        warehouseId,
        normalized,
        'purchase_return_out',
        'purchase_return',
        returnId,
        now,
        executor,
      )
    }
  }

  async postManufacturingMaterialConsumption(
    actorId: string,
    warehouseId: string,
    orderId: string,
    materials: Array<{
      materialId: string
      productId: string
      unitId: string
      quantity: string
    }>,
    executor: SqlExecutor,
  ): Promise<{ totalCost: string; materials: Array<{ materialId: string; unitCost: string }> }> {
    await this.access.assertPermission(actorId, 'manufacturing.manage', executor)
    await this.assertWarehouseScope(actorId, warehouseId, executor)
    const now = new Date().toISOString()
    let totalCost = 0n
    const costs: Array<{ materialId: string; unitCost: string }> = []
    for (const material of materials) {
      const normalized = await this.normalizeQuantity(
        material.productId,
        material.unitId,
        material.quantity,
        executor,
      )
      const balance = await this.repository.getBalance(
        material.productId,
        warehouseId,
        executor,
      )
      const baseUnitCost = parseDecimal(balance.averageUnitCost, 'Average unit cost')
      totalCost += multiplyDecimal(normalized.baseQuantity, baseUnitCost)
      const unit = await this.getProductUnit(
        material.productId,
        material.unitId,
        executor,
      )
      costs.push({
        materialId: material.materialId,
        unitCost: formatDecimal(multiplyDecimal(
          baseUnitCost,
          parseDecimal(unit.factor_to_base, 'Unit conversion factor'),
        )),
      })
      await this.applyDecrease(
        actorId,
        warehouseId,
        normalized,
        'manufacturing_material_out',
        'manufacturing_order',
        orderId,
        now,
        executor,
      )
    }
    return { totalCost: formatDecimal(totalCost), materials: costs }
  }

  async postManufacturingOutput(
    actorId: string,
    warehouseId: string,
    outputId: string,
    productId: string,
    unitId: string,
    quantity: string,
    unitCostBase: string,
    executor: SqlExecutor,
  ): Promise<void> {
    await this.access.assertPermission(actorId, 'manufacturing.manage', executor)
    await this.assertWarehouseScope(actorId, warehouseId, executor)
    const normalized = await this.normalizeQuantity(
      productId,
      unitId,
      quantity,
      executor,
    )
    await this.applyIncrease(
      actorId,
      warehouseId,
      normalized,
      parseDecimal(unitCostBase, 'Production unit cost'),
      'production_in',
      'production_output',
      outputId,
      new Date().toISOString(),
      executor,
    )
  }

  async postSaleOutbound(
    actorId: string,
    warehouseId: string,
    saleId: string,
    items: Array<{ productId: string; unitId: string; quantity: string }>,
    executor: SqlExecutor,
  ): Promise<void> {
    await this.access.assertPermission(actorId, 'sales.create', executor)
    await this.assertWarehouseScope(actorId, warehouseId, executor)
    const now = new Date().toISOString()
    for (const item of items) {
      const normalized = await this.normalizeQuantity(
        item.productId,
        item.unitId,
        item.quantity,
        executor,
      )
      await this.applyDecrease(
        actorId,
        warehouseId,
        normalized,
        'sale_out',
        'sale',
        saleId,
        now,
        executor,
      )
    }
  }

  async postSaleReturnInbound(
    actorId: string,
    warehouseId: string,
    saleId: string,
    returnId: string,
    items: Array<{ productId: string; unitId: string; quantity: string }>,
    executor: SqlExecutor,
  ): Promise<void> {
    await this.postSaleInbound(
      actorId,
      'sales.returns',
      warehouseId,
      saleId,
      returnId,
      items,
      'sale_return_in',
      'sales_return',
      executor,
    )
  }

  async postSaleCancellationInbound(
    actorId: string,
    warehouseId: string,
    saleId: string,
    cancellationId: string,
    items: Array<{ productId: string; unitId: string; quantity: string }>,
    executor: SqlExecutor,
  ): Promise<void> {
    await this.postSaleInbound(
      actorId,
      'sales.cancel',
      warehouseId,
      saleId,
      cancellationId,
      items,
      'sale_cancel_in',
      'sale_cancellation',
      executor,
    )
  }

  async getValuation(
    actorId: string,
    warehouseId: string,
  ): Promise<{ warehouseId: string; method: 'weighted_average'; totalValue: string; items: InventoryBalance[] }> {
    await this.assertWarehousePermission(
      actorId,
      'inventory.read',
      warehouseId,
      this.database,
    )
    const items = (await this.repository.listValuation(warehouseId)).map(
      (row) => {
        const quantity = this.rowString(row.on_hand_quantity)
        const averageUnitCost = this.rowString(row.average_unit_cost)
        return {
          productId: this.rowString(row.product_id),
          sku: this.rowString(row.sku),
          productName: this.rowString(row.name),
          baseUnitId: this.rowString(row.base_unit_id),
          warehouseId,
          quantity,
          averageUnitCost,
          inventoryValue: formatDecimal(
            multiplyDecimal(
              parseDecimal(quantity, 'Balance quantity'),
              parseDecimal(averageUnitCost, 'Average unit cost'),
            ),
          ),
          updatedAt: this.rowString(row.updated_at),
        }
      },
    ).filter((item) => parseDecimal(item.quantity, 'Balance quantity') > 0n)

    const total = items.reduce(
      (sum, item) =>
        sum +
        parseDecimal(item.inventoryValue, 'Inventory value'),
      0n,
    )
    return {
      warehouseId,
      method: 'weighted_average',
      totalValue: formatDecimal(total),
      items,
    }
  }

  async createTransfer(actorId: string, input: unknown): Promise<string> {
    const parsed = transferInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new InventoryError('The stock transfer details are invalid')
    }
    if (parsed.data.fromWarehouseId === parsed.data.toWarehouseId) {
      throw new InventoryError('A transfer must use different warehouses')
    }
    if (
      new Set(parsed.data.items.map((item) => item.productId)).size !==
      parsed.data.items.length
    ) {
      throw new InventoryError(
        'A product may appear only once in a stock transfer',
      )
    }

    const transferId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const source = await this.assertWarehousePermission(
        actorId,
        'inventory.transfer',
        parsed.data.fromWarehouseId,
        transaction,
      )
      const destination = await this.assertWarehousePermission(
        actorId,
        'inventory.transfer',
        parsed.data.toWarehouseId,
        transaction,
      )
      const normalizedItems: NormalizedInput[] = []
      for (const item of parsed.data.items) {
        normalizedItems.push(
          await this.normalizeQuantity(
            item.productId,
            item.unitId,
            item.quantity,
            transaction,
          ),
        )
      }

      await this.repository.createTransfer(
        {
          id: transferId,
          transferNumber: `TR-${transferId.slice(0, 8).toUpperCase()}`,
          fromBranchId: source.branchId,
          fromWarehouseId: parsed.data.fromWarehouseId,
          toBranchId: destination.branchId,
          toWarehouseId: parsed.data.toWarehouseId,
          notes: parsed.data.notes ?? null,
          requestedBy: actorId,
          createdAt: now,
        },
        transaction,
      )
      for (const item of normalizedItems) {
        await this.repository.addTransferItem(
          {
            id: createUuid(),
            transferId,
            productId: item.productId,
            unitId: item.baseUnitId,
            quantity: item.baseQuantityText,
            createdAt: now,
          },
          transaction,
        )
      }
      await this.writeAudit(
        transaction,
        actorId,
        'stock_transfer.created',
        'stock_transfer',
        transferId,
        null,
        {
          fromWarehouseId: parsed.data.fromWarehouseId,
          toWarehouseId: parsed.data.toWarehouseId,
          itemCount: normalizedItems.length,
        },
        now,
      )
    })
    return transferId
  }

  async submitTransfer(actorId: string, transferId: string): Promise<void> {
    await this.changeTransferStatus(
      actorId,
      transferId,
      ['draft'],
      'pending_approval',
      'stock_transfer.submitted',
    )
  }

  async approveTransfer(actorId: string, transferId: string): Promise<void> {
    await this.database.withTransaction(async (transaction) => {
      const transfer = await this.requireTransfer(
        transferId,
        transaction,
      )
      await this.assertTransferAccess(actorId, transfer, transaction)
      if (transfer.status !== 'pending_approval') {
        throw new InventoryError(
          'Only pending transfers can be approved',
        )
      }
      await this.repository.setTransferStatus(
        transferId,
        'approved',
        new Date().toISOString(),
        transaction,
        actorId,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'stock_transfer.approved',
        'stock_transfer',
        transferId,
        { status: transfer.status },
        { status: 'approved' },
        new Date().toISOString(),
      )
    })
  }

  async dispatchTransfer(actorId: string, transferId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const transfer = await this.requireTransfer(
        transferId,
        transaction,
      )
      await this.assertTransferAccess(actorId, transfer, transaction)
      if (transfer.status !== 'approved') {
        throw new InventoryError('Only approved transfers can be dispatched')
      }
      const items = await this.repository.getTransferItems(
        transferId,
        transaction,
      )
      if (items.length === 0) {
        throw new InventoryError('The transfer has no items')
      }

      for (const item of items) {
        const normalized = this.transferItem(item)
        const balance = await this.repository.getBalance(
          normalized.productId,
          this.rowString(transfer.from_warehouse_id),
          transaction,
        )
        if (
          parseDecimal(balance.quantity, 'Balance quantity') <
          parseDecimal(normalized.quantity, 'Transfer quantity')
        ) {
          throw new InventoryError(
            `Insufficient stock for product ${normalized.productId}`,
          )
        }
      }

      for (const item of items) {
        const normalized = this.transferItem(item)
        await this.applyDecrease(
          actorId,
          this.rowString(transfer.from_warehouse_id),
          {
            productId: normalized.productId,
            baseUnitId: normalized.unitId,
            baseQuantity: parseDecimal(
              normalized.quantity,
              'Transfer quantity',
            ),
            baseQuantityText: normalized.quantity,
          },
          'transfer_out',
          'stock_transfer',
          transferId,
          now,
          transaction,
        )
      }
      await this.repository.setTransferStatus(
        transferId,
        'in_transit',
        now,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'stock_transfer.dispatched',
        'stock_transfer',
        transferId,
        { status: 'approved' },
        { status: 'in_transit' },
        now,
      )
    })
  }

  async receiveTransfer(actorId: string, transferId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const transfer = await this.requireTransfer(
        transferId,
        transaction,
      )
      await this.assertTransferAccess(actorId, transfer, transaction)
      if (transfer.status !== 'in_transit') {
        throw new InventoryError('Only in-transit transfers can be received')
      }
      const items = await this.repository.getTransferItems(
        transferId,
        transaction,
      )
      if (items.length === 0) {
        throw new InventoryError('The transfer has no items')
      }

      for (const item of items) {
        const normalized = this.transferItem(item)
        const unitCost = await this.repository.getTransferMovementCost(
          transferId,
          this.rowString(transfer.from_warehouse_id),
          normalized.productId,
          transaction,
        )
        if (unitCost === null) {
          throw new InventoryError(
            'The transfer has no matching outbound inventory movement',
          )
        }
        await this.applyIncrease(
          actorId,
          this.rowString(transfer.to_warehouse_id),
          {
            productId: normalized.productId,
            baseUnitId: normalized.unitId,
            baseQuantity: parseDecimal(
              normalized.quantity,
              'Transfer quantity',
            ),
            baseQuantityText: normalized.quantity,
          },
          parseDecimal(unitCost, 'Transfer unit cost'),
          'transfer_in',
          'stock_transfer',
          transferId,
          now,
          transaction,
        )
        await this.repository.setTransferItemReceived(
          normalized.id,
          normalized.quantity,
          transaction,
        )
      }
      await this.repository.setTransferStatus(
        transferId,
        'received',
        now,
        transaction,
        actorId,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'stock_transfer.received',
        'stock_transfer',
        transferId,
        { status: 'in_transit' },
        { status: 'received' },
        now,
      )
    })
  }

  async cancelTransfer(actorId: string, transferId: string): Promise<void> {
    await this.changeTransferStatus(
      actorId,
      transferId,
      ['draft', 'pending_approval', 'approved'],
      'cancelled',
      'stock_transfer.cancelled',
    )
  }

  async getTransfer(
    actorId: string,
    transferId: string,
  ): Promise<StockTransfer> {
    const transfer = await this.requireTransfer(transferId, this.database)
    await this.assertTransferAccess(actorId, transfer, this.database)
    return this.mapTransfer(transfer, this.database)
  }

  async listTransfers(
    actorId: string,
    warehouseId: string,
  ): Promise<StockTransfer[]> {
    await this.assertWarehousePermission(
      actorId,
      'inventory.transfer',
      warehouseId,
      this.database,
    )
    const rows = await this.repository.listTransfersForWarehouse(warehouseId)
    const visible: StockTransfer[] = []
    for (const row of rows) {
      if (await this.canAccessTransfer(actorId, row, this.database)) {
        visible.push(await this.mapTransfer(row, this.database))
      }
    }
    return visible
  }

  async createStockCount(
    actorId: string,
    input: unknown,
  ): Promise<string> {
    const parsed = countInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new InventoryError('The stock count details are invalid')
    }
    if (new Set(parsed.data.productIds).size !== parsed.data.productIds.length) {
      throw new InventoryError('A product may appear only once in a stock count')
    }

    const countId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.assertWarehousePermission(
        actorId,
        'inventory.count',
        parsed.data.warehouseId,
        transaction,
      )
      await this.repository.createCount(
        {
          id: countId,
          countNumber: `CNT-${countId.slice(0, 8).toUpperCase()}`,
          warehouseId: parsed.data.warehouseId,
          countedBy: actorId,
          createdAt: now,
        },
        transaction,
      )
      for (const productId of parsed.data.productIds) {
        const product = await this.requireActiveProduct(
          productId,
          transaction,
        )
        const baseUnitId = this.rowString(product.base_unit_id)
        const balance = await this.repository.getBalance(
          productId,
          parsed.data.warehouseId,
          transaction,
        )
        await this.repository.addCountItem(
          {
            id: createUuid(),
            countId,
            productId,
            expectedQuantity: balance.quantity,
            unitId: baseUnitId,
          },
          transaction,
        )
      }
      await this.writeAudit(
        transaction,
        actorId,
        'stock_count.created',
        'stock_count',
        countId,
        null,
        {
          warehouseId: parsed.data.warehouseId,
          productIds: parsed.data.productIds,
        },
        now,
      )
    })
    return countId
  }

  async getStockCount(
    actorId: string,
    countId: string,
  ): Promise<StockCount> {
    const count = await this.requireCount(countId, this.database)
    await this.assertWarehousePermission(
      actorId,
      'inventory.count',
      this.rowString(count.warehouse_id),
      this.database,
    )
    return this.mapCount(count, this.database)
  }

  async listStockCounts(
    actorId: string,
    warehouseId: string,
  ): Promise<StockCount[]> {
    await this.assertWarehousePermission(
      actorId,
      'inventory.count',
      warehouseId,
      this.database,
    )
    const rows = await this.repository.listCountsForWarehouse(warehouseId)
    return Promise.all(
      rows.map((row) => this.mapCount(row, this.database)),
    )
  }

  async startStockCount(actorId: string, countId: string): Promise<void> {
    await this.changeCountStatus(
      actorId,
      countId,
      'draft',
      'counting',
      'stock_count.started',
    )
  }

  async recordStockCount(
    actorId: string,
    countId: string,
    input: unknown,
  ): Promise<void> {
    const parsed = countEntrySchema.safeParse(input)
    if (
      !parsed.success ||
      !uuidSchema.safeParse(countId).success
    ) {
      throw new InventoryError('The stock count entry is invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const count = await this.requireCount(countId, transaction)
      await this.assertWarehousePermission(
        actorId,
        'inventory.count',
        this.rowString(count.warehouse_id),
        transaction,
      )
      if (count.status !== 'counting') {
        throw new InventoryError('Only active stock counts can be recorded')
      }
      const item = await this.repository.getCountItem(
        countId,
        parsed.data.productId,
        transaction,
      )
      if (!item) {
        throw new InventoryError('The product is not part of this stock count')
      }
      const normalized = await this.normalizeQuantity(
        parsed.data.productId,
        parsed.data.unitId,
        parsed.data.countedQuantity,
        transaction,
        true,
      )
      if (normalized.baseQuantity < 0n) {
        throw new InventoryError('Counted quantity cannot be negative')
      }
      await this.repository.recordCountItem(
        this.rowString(item.id),
        normalized.baseQuantityText,
        parsed.data.notes ?? null,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'stock_count.item_recorded',
        'stock_count_item',
        this.rowString(item.id),
        null,
        {
          countId,
          productId: parsed.data.productId,
          countedQuantity: normalized.baseQuantityText,
          unitId: normalized.baseUnitId,
        },
        now,
      )
    })
  }

  async approveStockCount(actorId: string, countId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const count = await this.requireCount(countId, transaction)
      await this.assertWarehousePermission(
        actorId,
        'inventory.count',
        this.rowString(count.warehouse_id),
        transaction,
      )
      if (count.status !== 'counting') {
        throw new InventoryError('Only active stock counts can be approved')
      }
      const items = await this.repository.getCountItems(
        countId,
        transaction,
      )
      if (
        items.length === 0 ||
        items.some((item) => item.counted_quantity === null)
      ) {
        throw new InventoryError(
          'Every stock count item must have a counted quantity before approval',
        )
      }

      for (const item of items) {
        const productId = this.rowString(item.product_id)
        const countedQuantity = this.rowString(item.counted_quantity)
        const currentBalance = await this.repository.getBalance(
          productId,
          this.rowString(count.warehouse_id),
          transaction,
        )
        const counted = parseDecimal(countedQuantity, 'Counted quantity')
        const current = parseDecimal(
          currentBalance.quantity,
          'Current balance',
        )
        if (counted === current) {
          continue
        }
        const product = await this.requireActiveProduct(productId, transaction)
        const baseUnitId = this.rowString(product.base_unit_id)
        const difference = counted > current ? counted - current : current - counted
        const normalized: NormalizedInput = {
          productId,
          baseUnitId,
          baseQuantity: difference,
          baseQuantityText: formatDecimal(difference),
        }
        const movementId = createUuid()
        if (counted > current) {
          await this.applyIncrease(
            actorId,
            this.rowString(count.warehouse_id),
            normalized,
            parseDecimal(
              this.rowString(product.purchase_price),
              'Product purchase price',
            ),
            'count_adjustment_in',
            'stock_count',
            countId,
            now,
            transaction,
            movementId,
          )
        } else {
          await this.applyDecrease(
            actorId,
            this.rowString(count.warehouse_id),
            normalized,
            'count_adjustment_out',
            'stock_count',
            countId,
            now,
            transaction,
            movementId,
          )
        }
      }

      await this.repository.setCountStatus(
        countId,
        'approved',
        now,
        transaction,
        actorId,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'stock_count.approved',
        'stock_count',
        countId,
        { status: 'counting' },
        { status: 'approved', itemCount: items.length },
        now,
      )
    })
  }

  async cancelStockCount(actorId: string, countId: string): Promise<void> {
    await this.changeCountStatus(
      actorId,
      countId,
      'draft',
      'cancelled',
      'stock_count.cancelled',
      ['draft', 'counting'],
    )
  }

  private async applyIncrease(
    actorId: string,
    warehouseId: string,
    item: NormalizedInput,
    incomingUnitCost: bigint,
    movementType: string,
    sourceType: string,
    sourceId: string,
    now: string,
    executor: SqlExecutor,
    movementId = createUuid(),
  ): Promise<void> {
    if (item.baseQuantity <= 0n) {
      throw new InventoryError('Incoming stock quantity must be positive')
    }
    const previous = await this.repository.getBalance(
      item.productId,
      warehouseId,
      executor,
    )
    const oldQuantity = parseDecimal(previous.quantity, 'Balance quantity')
    const oldCost = parseDecimal(
      previous.averageUnitCost,
      'Average unit cost',
    )
    const nextQuantity = oldQuantity + item.baseQuantity
    const nextCost =
      oldQuantity <= 0n
        ? incomingUnitCost
        : divideDecimal(
            multiplyDecimal(oldQuantity, oldCost) +
              multiplyDecimal(item.baseQuantity, incomingUnitCost),
            nextQuantity,
          )
    await this.repository.setBalance(
      item.productId,
      warehouseId,
      formatDecimal(nextQuantity),
      formatDecimal(nextCost),
      now,
      executor,
    )
    await this.repository.addMovement(
      {
        id: movementId,
        productId: item.productId,
        warehouseId,
        movementType,
        quantity: item.baseQuantityText,
        unitId: item.baseUnitId,
        unitCost: formatDecimal(incomingUnitCost),
        sourceType,
        sourceId,
        actorId,
        occurredAt: now,
      },
      executor,
    )
  }

  private async applyDecrease(
    actorId: string,
    warehouseId: string,
    item: NormalizedInput,
    movementType: string,
    sourceType: string,
    sourceId: string,
    now: string,
    executor: SqlExecutor,
    movementId = createUuid(),
  ): Promise<void> {
    if (item.baseQuantity <= 0n) {
      throw new InventoryError('Outgoing stock quantity must be positive')
    }
    const previous = await this.repository.getBalance(
      item.productId,
      warehouseId,
      executor,
    )
    const oldQuantity = parseDecimal(previous.quantity, 'Balance quantity')
    if (oldQuantity < item.baseQuantity) {
      throw new InventoryError(
        `Insufficient stock for product ${item.productId}`,
      )
    }
    const unitCost = parseDecimal(
      previous.averageUnitCost,
      'Average unit cost',
    )
    const nextQuantity = oldQuantity - item.baseQuantity
    await this.repository.setBalance(
      item.productId,
      warehouseId,
      formatDecimal(nextQuantity),
      formatDecimal(unitCost),
      now,
      executor,
    )
    await this.repository.addMovement(
      {
        id: movementId,
        productId: item.productId,
        warehouseId,
        movementType,
        quantity: item.baseQuantityText,
        unitId: item.baseUnitId,
        unitCost: formatDecimal(unitCost),
        sourceType,
        sourceId,
        actorId,
        occurredAt: now,
      },
      executor,
    )
  }

  private async normalizeQuantity(
    productId: string,
    unitId: string,
    quantityValue: string,
    executor: SqlExecutor,
    allowZero = false,
    allowInactiveProduct = false,
  ): Promise<NormalizedInput> {
    const quantity = parseDecimal(quantityValue, 'Quantity')
    if (quantity < 0n) {
      throw new InventoryError('Quantity cannot be negative')
    }
    if (!allowZero && quantity === 0n) {
      throw new InventoryError('Quantity must be greater than zero')
    }
    const product = allowInactiveProduct
      ? await this.repository.getProduct(productId, executor)
      : await this.requireActiveProduct(productId, executor)
    if (!product) {
      throw new InventoryError('The product does not exist')
    }
    const baseUnitId = this.rowString(product.base_unit_id)
    const unit = await this.getProductUnit(productId, unitId, executor)
    const unitPlaces = this.rowInteger(unit.decimal_places)
    if (!quantityWithinPrecision(quantity, unitPlaces)) {
      throw new InventoryError(
        'Quantity exceeds the selected unit fractional precision',
      )
    }
    const factor = parseDecimal(
      this.rowString(unit.factor_to_base),
      'Unit conversion factor',
    )
    const baseQuantity = multiplyDecimal(quantity, factor)
    const baseUnit = await this.getProductUnit(
      productId,
      baseUnitId,
      executor,
    )
    if (!quantityWithinPrecision(baseQuantity, this.rowInteger(baseUnit.decimal_places))) {
      throw new InventoryError(
        'Converted quantity exceeds the product base unit fractional precision',
      )
    }
    return {
      productId,
      baseUnitId,
      baseQuantity,
      baseQuantityText: formatDecimal(baseQuantity),
    }
  }

  private async postSaleInbound(
    actorId: string,
    permission: 'sales.returns' | 'sales.cancel',
    warehouseId: string,
    saleId: string,
    sourceId: string,
    items: Array<{ productId: string; unitId: string; quantity: string }>,
    movementType: string,
    sourceType: string,
    executor: SqlExecutor,
  ): Promise<void> {
    await this.access.assertPermission(actorId, permission, executor)
    await this.assertWarehouseScope(actorId, warehouseId, executor)
    const now = new Date().toISOString()
    for (const item of items) {
      const normalized = await this.normalizeQuantity(
        item.productId,
        item.unitId,
        item.quantity,
        executor,
        false,
        true,
      )
      const unitCost = await this.repository.getSaleMovementCost(
        saleId,
        warehouseId,
        normalized.productId,
        executor,
      )
      if (unitCost === null) {
        throw new InventoryError(
          'The sale has no matching outbound inventory movement',
        )
      }
      await this.applyIncrease(
        actorId,
        warehouseId,
        normalized,
        parseDecimal(unitCost, 'Sale unit cost'),
        movementType,
        sourceType,
        sourceId,
        now,
        executor,
      )
    }
  }

  private async assertWarehouseScope(
    actorId: string,
    warehouseId: string,
    executor: SqlExecutor,
  ): Promise<void> {
    if (!uuidSchema.safeParse(warehouseId).success) {
      throw new InventoryError('The warehouse identifier is invalid')
    }
    const warehouse = await this.repository.getWarehouse(warehouseId, executor)
    if (
      !warehouse ||
      warehouse.warehouse_status !== 'active' ||
      warehouse.branch_status !== 'active'
    ) {
      throw new InventoryError('The warehouse or its branch is inactive')
    }
    const branchId = this.rowString(warehouse.branch_id)
    await this.access.assertWarehouseAccess(
      actorId,
      warehouseId,
      branchId,
      executor,
    )
    await this.access.assertBranchAccess(actorId, branchId, executor)
  }

  private async getProductUnit(
    productId: string,
    unitId: string,
    executor: SqlExecutor,
  ): Promise<{ decimal_places: number; factor_to_base: string }> {
    const unit = await this.repository.getProductUnit(
      productId,
      unitId,
      executor,
    )
    if (!unit) {
      throw new InventoryError(
        'The unit is inactive or is not configured for this product',
      )
    }
    return {
      decimal_places: this.rowInteger(unit.decimal_places),
      factor_to_base: this.rowString(unit.factor_to_base),
    }
  }

  private async requireActiveProduct(
    productId: string,
    executor: SqlExecutor,
  ): Promise<SqlRow> {
    if (!uuidSchema.safeParse(productId).success) {
      throw new InventoryError('The product identifier is invalid')
    }
    const product = await this.repository.getProduct(productId, executor)
    if (!product || product.status !== 'active') {
      throw new InventoryError('The product does not exist or is inactive')
    }
    return product
  }

  private async assertWarehousePermission(
    actorId: string,
    permission: 'inventory.adjust' | 'inventory.read' | 'inventory.transfer' | 'inventory.count',
    warehouseId: string,
    executor: SqlExecutor,
  ): Promise<{ branchId: string }> {
    if (!uuidSchema.safeParse(warehouseId).success) {
      throw new InventoryError('The warehouse identifier is invalid')
    }
    const warehouse = await this.repository.getWarehouse(
      warehouseId,
      executor,
    )
    if (
      !warehouse ||
      warehouse.warehouse_status !== 'active' ||
      warehouse.branch_status !== 'active'
    ) {
      throw new InventoryError('The warehouse or its branch is inactive')
    }
    const branchId = this.rowString(warehouse.branch_id)
    await this.access.assertWarehousePermission(
      actorId,
      permission,
      warehouseId,
      branchId,
      executor,
    )
    await this.access.assertBranchAccess(actorId, branchId, executor)
    return { branchId }
  }

  private async assertTransferAccess(
    actorId: string,
    transfer: SqlRow,
    executor: SqlExecutor,
  ): Promise<void> {
    if (!(await this.canAccessTransfer(actorId, transfer, executor))) {
      throw new AuthorizationError(
        'The user cannot access both warehouses in this transfer',
      )
    }
  }

  private async canAccessTransfer(
    actorId: string,
    transfer: SqlRow,
    executor: SqlExecutor,
  ): Promise<boolean> {
    const principal = await this.authRepository.getPrincipal(actorId, executor)
    if (!principal || !principal.permissions.includes('inventory.transfer')) {
      return false
    }
    const sourceWarehouseId = this.rowString(transfer.from_warehouse_id)
    const destinationWarehouseId = this.rowString(transfer.to_warehouse_id)
    const source = await this.repository.getWarehouse(
      sourceWarehouseId,
      executor,
    )
    const destination = await this.repository.getWarehouse(
      destinationWarehouseId,
      executor,
    )
    if (
      !source ||
      !destination ||
      source.warehouse_status !== 'active' ||
      source.branch_status !== 'active' ||
      destination.warehouse_status !== 'active' ||
      destination.branch_status !== 'active'
    ) {
      return false
    }
    if (principal.roleCodes.includes('system_owner')) {
      return true
    }
    return (
      (await this.authRepository.hasWarehouseAccess(
        actorId,
        sourceWarehouseId,
        this.rowString(source.branch_id),
        executor,
      )) &&
      (await this.authRepository.hasWarehouseAccess(
        actorId,
        destinationWarehouseId,
        this.rowString(destination.branch_id),
        executor,
      ))
    )
  }

  private async mapTransfer(
    row: SqlRow,
    executor: SqlExecutor,
  ): Promise<StockTransfer> {
    const items = await this.repository.getTransferItems(
      this.rowString(row.id),
      executor,
    )
    return {
      id: this.rowString(row.id),
      transferNumber: this.rowString(row.transfer_number),
      fromBranchId: this.rowString(row.from_branch_id),
      fromWarehouseId: this.rowString(row.from_warehouse_id),
      toBranchId: this.rowString(row.to_branch_id),
      toWarehouseId: this.rowString(row.to_warehouse_id),
      status: this.rowString(row.status),
      notes: typeof row.notes === 'string' ? row.notes : null,
      requestedBy: this.rowString(row.requested_by),
      approvedBy:
        typeof row.approved_by === 'string' ? row.approved_by : null,
      receivedBy:
        typeof row.received_by === 'string' ? row.received_by : null,
      createdAt: this.rowString(row.created_at),
      updatedAt: this.rowString(row.updated_at),
      items: items.map((item) => ({
        id: this.rowString(item.id),
        productId: this.rowString(item.product_id),
        unitId: this.rowString(item.unit_id),
        quantity: this.rowString(item.quantity),
        receivedQuantity:
          typeof item.received_quantity === 'string'
            ? item.received_quantity
            : null,
      })),
    }
  }

  private async mapCount(
    row: SqlRow,
    executor: SqlExecutor,
  ): Promise<StockCount> {
    const items = await this.repository.getCountItems(
      this.rowString(row.id),
      executor,
    )
    return {
      id: this.rowString(row.id),
      countNumber: this.rowString(row.count_number),
      warehouseId: this.rowString(row.warehouse_id),
      status: this.rowString(row.status),
      countedBy:
        typeof row.counted_by === 'string' ? row.counted_by : null,
      approvedBy:
        typeof row.approved_by === 'string' ? row.approved_by : null,
      startedAt:
        typeof row.started_at === 'string' ? row.started_at : null,
      completedAt:
        typeof row.completed_at === 'string' ? row.completed_at : null,
      createdAt: this.rowString(row.created_at),
      updatedAt: this.rowString(row.updated_at),
      items: items.map((item) => ({
        id: this.rowString(item.id),
        productId: this.rowString(item.product_id),
        expectedQuantity: this.rowString(item.expected_quantity),
        countedQuantity:
          typeof item.counted_quantity === 'string'
            ? item.counted_quantity
            : null,
        unitId: this.rowString(item.unit_id),
        notes: typeof item.notes === 'string' ? item.notes : null,
      })),
    }
  }

  private async requireTransfer(
    transferId: string,
    executor: SqlExecutor,
  ): Promise<SqlRow> {
    if (!uuidSchema.safeParse(transferId).success) {
      throw new InventoryError('The stock transfer identifier is invalid')
    }
    const transfer = await this.repository.getTransfer(
      transferId,
      executor,
    )
    if (!transfer) {
      throw new InventoryError('The stock transfer does not exist')
    }
    return transfer
  }

  private async requireCount(
    countId: string,
    executor: SqlExecutor,
  ): Promise<SqlRow> {
    if (!uuidSchema.safeParse(countId).success) {
      throw new InventoryError('The stock count identifier is invalid')
    }
    const count = await this.repository.getCount(countId, executor)
    if (!count) {
      throw new InventoryError('The stock count does not exist')
    }
    return count
  }

  private async changeTransferStatus(
    actorId: string,
    transferId: string,
    allowedStatuses: string[],
    nextStatus: string,
    action: string,
  ): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const transfer = await this.requireTransfer(transferId, transaction)
      await this.assertTransferAccess(actorId, transfer, transaction)
      const status = this.rowString(transfer.status)
      if (!allowedStatuses.includes(status)) {
        throw new InventoryError(
          `A transfer in ${status} status cannot be changed to ${nextStatus}`,
        )
      }
      await this.repository.setTransferStatus(
        transferId,
        nextStatus,
        now,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        action,
        'stock_transfer',
        transferId,
        { status },
        { status: nextStatus },
        now,
      )
    })
  }

  private async changeCountStatus(
    actorId: string,
    countId: string,
    requiredStatus: string,
    nextStatus: string,
    action: string,
    allowedStatuses = [requiredStatus],
  ): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const count = await this.requireCount(countId, transaction)
      await this.assertWarehousePermission(
        actorId,
        'inventory.count',
        this.rowString(count.warehouse_id),
        transaction,
      )
      const status = this.rowString(count.status)
      if (!allowedStatuses.includes(status)) {
        throw new InventoryError(
          `A stock count in ${status} status cannot be changed to ${nextStatus}`,
        )
      }
      await this.repository.setCountStatus(
        countId,
        nextStatus,
        now,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        action,
        'stock_count',
        countId,
        { status },
        { status: nextStatus },
        now,
      )
    })
  }

  private transferItem(row: SqlRow): {
    id: string
    productId: string
    unitId: string
    quantity: string
  } {
    return {
      id: this.rowString(row.id),
      productId: this.rowString(row.product_id),
      unitId: this.rowString(row.unit_id),
      quantity: this.rowString(row.quantity),
    }
  }

  private async writeAudit(
    executor: SqlExecutor,
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
    occurredAt: string,
  ): Promise<void> {
    await this.authRepository.writeAudit(
      {
        actorUserId: actorId,
        action,
        entityType,
        entityId,
        beforeData: before === null ? null : JSON.stringify(before),
        afterData: after === null ? null : JSON.stringify(after),
        occurredAt,
      },
      executor,
    )
  }

  private rowString(value: unknown): string {
    if (typeof value !== 'string') {
      throw new InventoryError('An inventory record contains invalid data')
    }
    return value
  }

  private rowInteger(value: unknown): number {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 9) {
      throw new InventoryError('An inventory unit precision is invalid')
    }
    return parsed
  }
}
