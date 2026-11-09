import { z } from 'zod'
import { createUuid } from '../../infrastructure/database/uuid'
import type { SqlDatabase, SqlExecutor, SqlRow } from '../../infrastructure/database/types'
import { AccessControlService } from '../auth/AccessControlService'
import { AuthRepository } from '../auth/AuthRepository'
import { AuthorizationError } from '../auth/auth.errors'
import { InventoryService } from '../inventory/InventoryService'
import {
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  quantityWithinPrecision,
} from '../inventory/decimal'
import { ManufacturingError } from './manufacturing.errors'
import { ManufacturingRepository } from './ManufacturingRepository'

const uuidSchema = z.string().uuid()
const decimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/)
const orderInputSchema = z.object({
  warehouseId: uuidSchema,
  finishedProductId: uuidSchema,
  plannedQuantity: decimalSchema,
  materials: z.array(z.object({
    productId: uuidSchema,
    unitId: uuidSchema,
    plannedQuantity: decimalSchema,
  })).min(1).max(200),
  stages: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  notes: z.string().trim().max(1000).nullable().optional(),
})
const consumeInputSchema = z.object({
  materials: z.array(z.object({
    materialId: uuidSchema,
    quantity: decimalSchema,
  })).min(1).max(200),
})
const costInputSchema = z.object({
  costType: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,39}$/),
  amount: decimalSchema,
  description: z.string().trim().min(2).max(500),
  incurredAt: z.string().datetime({ offset: true }).optional(),
})
const completionSchema = z.object({
  actualQuantity: decimalSchema,
  wasteQuantity: decimalSchema.default('0'),
})

export type ManufacturingOrder = {
  id: string
  orderNumber: string
  branchId: string
  warehouseId: string
  finishedProductId: string
  finishedSku: string
  finishedProductName: string
  plannedQuantity: string
  actualQuantity: string | null
  wasteQuantity: string | null
  status: string
  notes: string | null
  startedAt: string | null
  completedAt: string | null
  approvedBy: string | null
  createdAt: string
  updatedAt: string
  materials: Array<{
    id: string
    productId: string
    sku: string
    productName: string
    unitId: string
    unitName: string
    plannedQuantity: string
    consumedQuantity: string | null
    unitCost: string | null
    consumedAt: string | null
  }>
  stages: Array<{
    id: string
    name: string
    sequence: number
    status: string
    startedAt: string | null
    completedAt: string | null
  }>
  costs: Array<{
    id: string
    costType: string
    amount: string
    description: string
    incurredAt: string
  }>
  output: {
    id: string
    quantity: string
    unitId: string
    approvedAt: string | null
  } | null
  materialCost: string
  additionalCost: string
  totalCost: string
}

export class ManufacturingService {
  private readonly database: SqlDatabase
  private readonly access: AccessControlService
  private readonly authRepository: AuthRepository
  private readonly inventory: InventoryService
  private readonly repository: ManufacturingRepository

  constructor(database: SqlDatabase) {
    this.database = database
    this.access = new AccessControlService(database)
    this.authRepository = new AuthRepository(database)
    this.inventory = new InventoryService(database)
    this.repository = new ManufacturingRepository(database)
  }

  async createOrder(actorId: string, input: unknown): Promise<string> {
    const parsed = orderInputSchema.safeParse(input)
    if (
      !parsed.success ||
      new Set(parsed.data.materials.map((material) => material.productId)).size !==
        parsed.data.materials.length ||
      new Set(parsed.data.stages.map((stage) => stage.toLocaleLowerCase())).size !==
        parsed.data.stages.length
    ) {
      throw new ManufacturingError('The production order details are invalid')
    }
    const plannedQuantity = parseDecimal(parsed.data.plannedQuantity, 'Planned output')
    if (plannedQuantity <= 0n) {
      throw new ManufacturingError('Planned output must be greater than zero')
    }
    const orderId = createUuid()
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      await this.access.assertPermission(actorId, 'manufacturing.manage', transaction)
      const location = await this.assertWarehouseScope(
        actorId,
        parsed.data.warehouseId,
        transaction,
      )
      const outputProduct = await this.repository.getProduct(
        parsed.data.finishedProductId,
        transaction,
      )
      if (!outputProduct || outputProduct.status !== 'active') {
        throw new ManufacturingError('The finished product does not exist or is inactive')
      }
      const outputUnit = await this.repository.getProductUnit(
        parsed.data.finishedProductId,
        this.rowString(outputProduct.base_unit_id),
        transaction,
      )
      if (
        !outputUnit ||
        !quantityWithinPrecision(
          plannedQuantity,
          this.rowInteger(outputUnit.decimal_places),
        )
      ) {
        throw new ManufacturingError('Planned output exceeds the finished product base unit precision')
      }
      const materials: Array<{
        id: string
        productId: string
        unitId: string
        quantity: string
      }> = []
      for (const material of parsed.data.materials) {
        if (material.productId === parsed.data.finishedProductId) {
          throw new ManufacturingError('The finished product cannot be its own raw material')
        }
        await this.normalizeQuantity(
          material.productId,
          material.unitId,
          material.plannedQuantity,
          transaction,
        )
        materials.push({
          id: createUuid(),
          productId: material.productId,
          unitId: material.unitId,
          quantity: material.plannedQuantity,
        })
      }
      const count = await this.repository.countOrders(location.branchId, transaction)
      const orderNumber = `MFG-${String(count + 1).padStart(6, '0')}`
      await this.repository.createOrder({
        id: orderId,
        orderNumber,
        branchId: location.branchId,
        warehouseId: parsed.data.warehouseId,
        finishedProductId: parsed.data.finishedProductId,
        plannedQuantity: parsed.data.plannedQuantity,
        notes: parsed.data.notes ?? null,
        actorId,
        createdAt: now,
      }, transaction)
      for (const material of materials) {
        await this.repository.addMaterial({
          id: material.id,
          orderId,
          productId: material.productId,
          unitId: material.unitId,
          quantity: material.quantity,
          createdAt: now,
        }, transaction)
      }
      for (const [sequence, name] of parsed.data.stages.entries()) {
        await this.repository.addStage({
          id: createUuid(),
          orderId,
          name,
          sequence,
          createdAt: now,
        }, transaction)
      }
      await this.writeAudit(
        transaction,
        actorId,
        'manufacturing.order_created',
        'manufacturing_order',
        orderId,
        null,
        {
          orderNumber,
          warehouseId: parsed.data.warehouseId,
          finishedProductId: parsed.data.finishedProductId,
          plannedQuantity: parsed.data.plannedQuantity,
          materialCount: materials.length,
          stages: parsed.data.stages,
        },
        now,
      )
    })
    return orderId
  }

  async listOrders(
    actorId: string,
    branchId: string,
    warehouseId?: string,
  ): Promise<ManufacturingOrder[]> {
    await this.access.assertPermission(actorId, 'manufacturing.manage')
    await this.assertBranchScope(actorId, branchId, this.database)
    if (warehouseId) {
      const location = await this.assertWarehouseScope(actorId, warehouseId, this.database)
      if (location.branchId !== branchId) {
        throw new ManufacturingError('The selected warehouse does not belong to the branch')
      }
    }
    const rows = (await this.repository.listOrders(branchId))
      .filter((row) => !warehouseId || row.warehouse_id === warehouseId)
    const orders: ManufacturingOrder[] = []
    for (const row of rows) {
      if (await this.canAccessOrder(actorId, row, this.database)) {
        orders.push(await this.mapOrder(row, this.database))
      }
    }
    return orders
  }

  async getOrder(actorId: string, orderId: string): Promise<ManufacturingOrder> {
    await this.access.assertPermission(actorId, 'manufacturing.manage')
    const order = await this.requireOrder(orderId, this.database)
    await this.assertWarehouseScope(
      actorId,
      this.rowString(order.warehouse_id),
      this.database,
    )
    return this.mapOrder(order, this.database)
  }

  async planOrder(actorId: string, orderId: string): Promise<void> {
    await this.changeStatus(actorId, orderId, 'draft', 'planned', 'manufacturing.order_planned')
  }

  async startOrder(actorId: string, orderId: string): Promise<void> {
    await this.changeStatus(
      actorId,
      orderId,
      'planned',
      'in_progress',
      'manufacturing.order_started',
      true,
    )
  }

  async consumeMaterials(actorId: string, orderId: string, input: unknown): Promise<void> {
    const parsed = consumeInputSchema.safeParse(input)
    if (
      !parsed.success ||
      new Set(parsed.data.materials.map((material) => material.materialId)).size !==
        parsed.data.materials.length
    ) {
      throw new ManufacturingError('The material consumption details are invalid')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const order = await this.requireOrder(orderId, transaction)
      await this.assertOrderPermission(actorId, order, transaction)
      if (order.status !== 'in_progress') {
        throw new ManufacturingError('Materials can only be consumed by an in-progress order')
      }
      const requirements: Array<{
        materialId: string
        productId: string
        unitId: string
        quantity: string
        previousQuantity: bigint
        previousCost: bigint
      }> = []
      for (const item of parsed.data.materials) {
        const material = await this.repository.getMaterial(item.materialId, transaction)
        if (!material || material.order_id !== orderId) {
          throw new ManufacturingError('A material does not belong to this production order')
        }
        const quantity = parseDecimal(item.quantity, 'Consumed quantity')
        const consumed = typeof material.consumed_quantity === 'string'
          ? parseDecimal(material.consumed_quantity, 'Previously consumed quantity')
          : 0n
        const planned = parseDecimal(this.rowString(material.planned_quantity), 'Planned material quantity')
        const unit = await this.repository.getProductUnit(
          this.rowString(material.product_id),
          this.rowString(material.unit_id),
          transaction,
        )
        if (
          quantity <= 0n ||
          consumed + quantity > planned ||
          !unit ||
          !quantityWithinPrecision(quantity, this.rowInteger(unit.decimal_places))
        ) {
          throw new ManufacturingError('Consumed quantity exceeds or is invalid for its material requirement')
        }
        requirements.push({
          materialId: item.materialId,
          productId: this.rowString(material.product_id),
          unitId: this.rowString(material.unit_id),
          quantity: item.quantity,
          previousQuantity: consumed,
          previousCost: typeof material.unit_cost === 'string'
            ? parseDecimal(material.unit_cost, 'Previously captured material cost')
            : 0n,
        })
      }
      const posted = await this.inventory.postManufacturingMaterialConsumption(
        actorId,
        this.rowString(order.warehouse_id),
        orderId,
        requirements.map((item) => ({
          materialId: item.materialId,
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
        })),
        transaction,
      )
      const unitCosts = new Map(
        posted.materials.map((item) => [item.materialId, parseDecimal(item.unitCost, 'Material unit cost')]),
      )
      const auditItems: Array<{
        materialId: string
        quantity: string
        totalConsumed: string
        unitCost: string
      }> = []
      for (const item of requirements) {
        const addedCost = unitCosts.get(item.materialId)
        if (addedCost === undefined) {
          throw new ManufacturingError('A consumed material cost could not be calculated')
        }
        const newQuantity = parseDecimal(item.quantity, 'Consumed quantity')
        const totalQuantity = item.previousQuantity + newQuantity
        const averageCost = item.previousQuantity === 0n
          ? addedCost
          : divideDecimal(
              multiplyDecimal(item.previousQuantity, item.previousCost) +
                multiplyDecimal(newQuantity, addedCost),
              totalQuantity,
            )
        await this.repository.updateMaterialConsumption(
          item.materialId,
          formatDecimal(totalQuantity),
          formatDecimal(averageCost),
          now,
          transaction,
        )
        auditItems.push({
          materialId: item.materialId,
          quantity: item.quantity,
          totalConsumed: formatDecimal(totalQuantity),
          unitCost: formatDecimal(addedCost),
        })
      }
      await this.writeAudit(
        transaction,
        actorId,
        'manufacturing.materials_consumed',
        'manufacturing_order',
        orderId,
        null,
        {
          materials: auditItems,
          consumptionCost: posted.totalCost,
        },
        now,
      )
    })
  }

  async startStage(actorId: string, stageId: string): Promise<void> {
    await this.changeStage(actorId, stageId, 'start')
  }

  async completeStage(actorId: string, stageId: string): Promise<void> {
    await this.changeStage(actorId, stageId, 'complete')
  }

  async addProductionCost(actorId: string, orderId: string, input: unknown): Promise<string> {
    const parsed = costInputSchema.safeParse(input)
    if (!parsed.success || parseDecimal(parsed.data.amount, 'Production cost') <= 0n) {
      throw new ManufacturingError('The production cost details are invalid')
    }
    const costId = createUuid()
    const now = parsed.data.incurredAt ?? new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const order = await this.requireOrder(orderId, transaction)
      await this.assertOrderPermission(actorId, order, transaction)
      if (order.status !== 'in_progress') {
        throw new ManufacturingError('Production costs can only be added to an in-progress order')
      }
      await this.repository.addCost({
        id: costId,
        orderId,
        costType: parsed.data.costType,
        amount: formatDecimal(parseDecimal(parsed.data.amount, 'Production cost')),
        description: parsed.data.description,
        incurredAt: now,
      }, transaction)
      await this.writeAudit(
        transaction,
        actorId,
        'manufacturing.cost_recorded',
        'manufacturing_cost',
        costId,
        null,
        {
          orderId,
          costType: parsed.data.costType,
          amount: formatDecimal(parseDecimal(parsed.data.amount, 'Production cost')),
          description: parsed.data.description,
        },
        now,
      )
    })
    return costId
  }

  async completeOrder(actorId: string, orderId: string, input: unknown): Promise<void> {
    const parsed = completionSchema.safeParse(input)
    if (!parsed.success) {
      throw new ManufacturingError('The actual production quantities are invalid')
    }
    const actual = parseDecimal(parsed.data.actualQuantity, 'Actual production')
    const waste = parseDecimal(parsed.data.wasteQuantity, 'Production waste')
    if (actual <= 0n) {
      throw new ManufacturingError('Actual production must be greater than zero')
    }
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const order = await this.requireOrder(orderId, transaction)
      await this.assertOrderPermission(actorId, order, transaction)
      if (order.status !== 'in_progress') {
        throw new ManufacturingError('Only in-progress orders can be completed')
      }
      const planned = parseDecimal(this.rowString(order.planned_quantity), 'Planned output')
      if (actual + waste > planned) {
        throw new ManufacturingError('Actual output and waste cannot exceed planned production')
      }
      const finishedProductId = this.rowString(order.finished_product_id)
      const product = await this.repository.getProduct(finishedProductId, transaction)
      if (!product || product.status !== 'active') {
        throw new ManufacturingError('The finished product does not exist or is inactive')
      }
      const unitId = this.rowString(product.base_unit_id)
      const unit = await this.repository.getProductUnit(finishedProductId, unitId, transaction)
      if (
        !unit ||
        !quantityWithinPrecision(actual, this.rowInteger(unit.decimal_places)) ||
        !quantityWithinPrecision(waste, this.rowInteger(unit.decimal_places))
      ) {
        throw new ManufacturingError('Actual output or waste exceeds the finished product unit precision')
      }
      const materials = await this.repository.getMaterials(orderId, transaction)
      if (materials.some((material) => material.consumed_quantity === null)) {
        throw new ManufacturingError('Every raw material requirement must have recorded consumption')
      }
      const stages = await this.repository.listStages(orderId, transaction)
      if (stages.some((stage) => !['completed', 'skipped'].includes(this.rowString(stage.status)))) {
        throw new ManufacturingError('Every production stage must be completed or skipped')
      }
      const outputId = createUuid()
      await this.repository.createOutput({
        id: outputId,
        orderId,
        productId: finishedProductId,
        unitId,
        quantity: parsed.data.actualQuantity,
        createdAt: now,
      }, transaction)
      await transaction.run(
        `UPDATE manufacturing_orders
         SET actual_quantity = ?, waste_quantity = ?, status = 'completed',
             completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'in_progress'`,
        [parsed.data.actualQuantity, parsed.data.wasteQuantity, now, now, orderId],
      )
      await this.writeAudit(
        transaction,
        actorId,
        'manufacturing.order_completed',
        'manufacturing_order',
        orderId,
        { status: order.status },
        {
          status: 'completed',
          actualQuantity: parsed.data.actualQuantity,
          wasteQuantity: parsed.data.wasteQuantity,
          outputId,
        },
        now,
      )
    })
  }

  async approveFinishedGoods(actorId: string, orderId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const order = await this.requireOrder(orderId, transaction)
      await this.assertOrderPermission(actorId, order, transaction)
      if (order.status !== 'completed') {
        throw new ManufacturingError('Only completed orders can be approved')
      }
      const output = await this.repository.getOutput(orderId, transaction)
      if (!output || output.approved_at !== null) {
        throw new ManufacturingError('The finished goods output is missing or already approved')
      }
      const materials = await this.repository.getMaterials(orderId, transaction)
      let materialCost = 0n
      for (const material of materials) {
        if (material.consumed_quantity === null || material.unit_cost === null) {
          throw new ManufacturingError('Consumed material costs are incomplete')
        }
        materialCost += multiplyDecimal(
          parseDecimal(this.rowString(material.consumed_quantity), 'Consumed material quantity'),
          parseDecimal(this.rowString(material.unit_cost), 'Material unit cost'),
        )
      }
      const costs = await this.repository.listCosts(orderId, transaction)
      const additionalCost = costs.reduce(
        (sum, cost) => sum + parseDecimal(this.rowString(cost.amount), 'Production cost'),
        0n,
      )
      const actualQuantity = parseDecimal(this.rowString(output.quantity), 'Actual production')
      const unitCostBase = divideDecimal(materialCost + additionalCost, actualQuantity)
      const outputId = this.rowString(output.id)
      await this.inventory.postManufacturingOutput(
        actorId,
        this.rowString(order.warehouse_id),
        outputId,
        this.rowString(output.product_id),
        this.rowString(output.unit_id),
        this.rowString(output.quantity),
        formatDecimal(unitCostBase),
        transaction,
      )
      await this.repository.approveOutput(outputId, actorId, now, transaction)
      await this.repository.updateOrderStatus(
        orderId,
        'approved',
        now,
        null,
        null,
        actorId,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'manufacturing.output_approved',
        'production_output',
        outputId,
        { approvedAt: null },
        {
          approvedBy: actorId,
          approvedAt: now,
          unitCost: formatDecimal(unitCostBase),
          materialCost: formatDecimal(materialCost),
          additionalCost: formatDecimal(additionalCost),
        },
        now,
      )
    })
  }

  async cancelOrder(actorId: string, orderId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const order = await this.requireOrder(orderId, transaction)
      await this.assertOrderPermission(actorId, order, transaction)
      if (!['draft', 'planned'].includes(this.rowString(order.status))) {
        throw new ManufacturingError('Started production orders cannot be cancelled')
      }
      await this.repository.updateOrderStatus(
        orderId,
        'cancelled',
        now,
        null,
        null,
        null,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        'manufacturing.order_cancelled',
        'manufacturing_order',
        orderId,
        { status: order.status },
        { status: 'cancelled' },
        now,
      )
    })
  }

  private async changeStatus(
    actorId: string,
    orderId: string,
    expectedStatus: string,
    nextStatus: 'planned' | 'in_progress',
    action: string,
    started = false,
  ): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const order = await this.requireOrder(orderId, transaction)
      await this.assertOrderPermission(actorId, order, transaction)
      if (order.status !== expectedStatus) {
        throw new ManufacturingError(
          `A production order in ${this.rowString(order.status)} status cannot move to ${nextStatus}`,
        )
      }
      await this.repository.updateOrderStatus(
        orderId,
        nextStatus,
        now,
        started ? now : null,
        null,
        null,
        transaction,
      )
      await this.writeAudit(
        transaction,
        actorId,
        action,
        'manufacturing_order',
        orderId,
        { status: expectedStatus },
        { status: nextStatus },
        now,
      )
    })
  }

  private async changeStage(
    actorId: string,
    stageId: string,
    action: 'start' | 'complete',
  ): Promise<void> {
    const now = new Date().toISOString()
    await this.database.withTransaction(async (transaction) => {
      const stage = await this.repository.getStage(stageId, transaction)
      if (!stage) {
        throw new ManufacturingError('The production stage does not exist')
      }
      const order = await this.requireOrder(this.rowString(stage.order_id), transaction)
      await this.assertOrderPermission(actorId, order, transaction)
      if (order.status !== 'in_progress') {
        throw new ManufacturingError('Production stages require an in-progress order')
      }
      const stages = await this.repository.listStages(this.rowString(order.id), transaction)
      const currentIndex = stages.findIndex((item) => item.id === stageId)
      if (currentIndex < 0) {
        throw new ManufacturingError('The production stage does not exist')
      }
      if (stages.slice(0, currentIndex).some((item) =>
        !['completed', 'skipped'].includes(this.rowString(item.status)),
      )) {
        throw new ManufacturingError('Production stages must be handled in sequence')
      }
      if (action === 'start') {
        if (stage.status !== 'pending') {
          throw new ManufacturingError('Only pending stages can be started')
        }
        await this.repository.updateStage(stageId, 'in_progress', now, null, transaction)
      } else {
        if (stage.status !== 'in_progress') {
          throw new ManufacturingError('Only in-progress stages can be completed')
        }
        await this.repository.updateStage(
          stageId,
          'completed',
          typeof stage.started_at === 'string' ? stage.started_at : now,
          now,
          transaction,
        )
      }
      await this.writeAudit(
        transaction,
        actorId,
        `manufacturing.stage_${action}ed`,
        'production_stage',
        stageId,
        { status: stage.status },
        { status: action === 'start' ? 'in_progress' : 'completed' },
        now,
      )
    })
  }

  private async normalizeQuantity(
    productId: string,
    unitId: string,
    quantityText: string,
    executor: SqlExecutor,
  ): Promise<bigint> {
    const quantity = parseDecimal(quantityText, 'Material quantity')
    const product = await this.repository.getProduct(productId, executor)
    const unit = await this.repository.getProductUnit(productId, unitId, executor)
    if (!product || product.status !== 'active' || !unit) {
      throw new ManufacturingError('A raw material or its unit is missing or inactive')
    }
    const baseUnit = await this.repository.getProductUnit(
      productId,
      this.rowString(product.base_unit_id),
      executor,
    )
    if (
      quantity <= 0n ||
      !baseUnit ||
      !quantityWithinPrecision(quantity, this.rowInteger(unit.decimal_places)) ||
      !quantityWithinPrecision(
        multiplyDecimal(quantity, parseDecimal(this.rowString(unit.factor_to_base), 'Unit conversion factor')),
        this.rowInteger(baseUnit.decimal_places),
      )
    ) {
      throw new ManufacturingError('A raw material quantity is invalid for its configured unit')
    }
    return quantity
  }

  private async assertWarehouseScope(
    actorId: string,
    warehouseId: string,
    executor: SqlExecutor,
  ): Promise<{ branchId: string }> {
    if (!uuidSchema.safeParse(warehouseId).success) {
      throw new ManufacturingError('The warehouse identifier is invalid')
    }
    const warehouse = await this.repository.getWarehouse(warehouseId, executor)
    if (
      !warehouse ||
      warehouse.warehouse_status !== 'active' ||
      warehouse.branch_status !== 'active'
    ) {
      throw new ManufacturingError('The warehouse or its branch is inactive')
    }
    if (warehouse.warehouse_type !== 'clothing_manufacturing') {
      throw new ManufacturingError(
        'Manufacturing is only available in clothing manufacturing warehouses',
      )
    }
    const branchId = this.rowString(warehouse.branch_id)
    await this.access.assertWarehouseAccess(actorId, warehouseId, branchId, executor)
    await this.access.assertBranchAccess(actorId, branchId, executor)
    return { branchId }
  }

  private async assertBranchScope(
    actorId: string,
    branchId: string,
    executor: SqlExecutor,
  ): Promise<void> {
    await this.access.assertBranchAccess(actorId, branchId, executor)
    const [branch] = await executor.query(
      "SELECT id FROM branches WHERE id = ? AND status = 'active'",
      [branchId],
    )
    if (!branch) {
      throw new ManufacturingError('The active branch does not exist')
    }
  }

  private async assertOrderPermission(
    actorId: string,
    order: SqlRow,
    executor: SqlExecutor,
  ): Promise<void> {
    await this.access.assertPermission(actorId, 'manufacturing.manage', executor)
    await this.assertWarehouseScope(
      actorId,
      this.rowString(order.warehouse_id),
      executor,
    )
  }

  private async canAccessOrder(
    actorId: string,
    order: SqlRow,
    executor: SqlExecutor,
  ): Promise<boolean> {
    try {
      await this.assertWarehouseScope(
        actorId,
        this.rowString(order.warehouse_id),
        executor,
      )
      return true
    } catch (error) {
      if (error instanceof ManufacturingError || error instanceof AuthorizationError) {
        return false
      }
      throw error
    }
  }

  private async requireOrder(
    orderId: string,
    executor: SqlExecutor,
  ): Promise<SqlRow> {
    if (!uuidSchema.safeParse(orderId).success) {
      throw new ManufacturingError('The production order identifier is invalid')
    }
    const order = await this.repository.getOrder(orderId, executor)
    if (!order) {
      throw new ManufacturingError('The production order does not exist')
    }
    return order
  }

  private async mapOrder(
    row: SqlRow,
    executor: SqlExecutor,
  ): Promise<ManufacturingOrder> {
    const orderId = this.rowString(row.id)
    const [materials, stages, costs, output] = await Promise.all([
      this.repository.getMaterials(orderId, executor),
      this.repository.listStages(orderId, executor),
      this.repository.listCosts(orderId, executor),
      this.repository.getOutput(orderId, executor),
    ])
    let materialCost = 0n
    for (const material of materials) {
      if (typeof material.consumed_quantity === 'string' && typeof material.unit_cost === 'string') {
        materialCost += multiplyDecimal(
          parseDecimal(material.consumed_quantity, 'Consumed quantity'),
          parseDecimal(material.unit_cost, 'Material unit cost'),
        )
      }
    }
    const additionalCost = costs.reduce(
      (sum, cost) => sum + parseDecimal(this.rowString(cost.amount), 'Production cost'),
      0n,
    )
    return {
      id: orderId,
      orderNumber: this.rowString(row.order_number),
      branchId: this.rowString(row.branch_id),
      warehouseId: this.rowString(row.warehouse_id),
      finishedProductId: this.rowString(row.finished_product_id),
      finishedSku: this.rowString(row.finished_sku),
      finishedProductName: this.rowString(row.finished_product_name),
      plannedQuantity: this.rowString(row.planned_quantity),
      actualQuantity: typeof row.actual_quantity === 'string' ? row.actual_quantity : null,
      wasteQuantity: typeof row.waste_quantity === 'string' ? row.waste_quantity : null,
      status: this.rowString(row.status),
      notes: typeof row.notes === 'string' ? row.notes : null,
      startedAt: typeof row.started_at === 'string' ? row.started_at : null,
      completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
      approvedBy: typeof row.approved_by === 'string' ? row.approved_by : null,
      createdAt: this.rowString(row.created_at),
      updatedAt: this.rowString(row.updated_at),
      materials: materials.map((material) => ({
        id: this.rowString(material.id),
        productId: this.rowString(material.product_id),
        sku: this.rowString(material.sku),
        productName: this.rowString(material.product_name),
        unitId: this.rowString(material.unit_id),
        unitName: this.rowString(material.unit_name),
        plannedQuantity: this.rowString(material.planned_quantity),
        consumedQuantity: typeof material.consumed_quantity === 'string' ? material.consumed_quantity : null,
        unitCost: typeof material.unit_cost === 'string' ? material.unit_cost : null,
        consumedAt: typeof material.consumed_at === 'string' ? material.consumed_at : null,
      })),
      stages: stages.map((stage) => ({
        id: this.rowString(stage.id),
        name: this.rowString(stage.name),
        sequence: this.rowInteger(stage.sequence),
        status: this.rowString(stage.status),
        startedAt: typeof stage.started_at === 'string' ? stage.started_at : null,
        completedAt: typeof stage.completed_at === 'string' ? stage.completed_at : null,
      })),
      costs: costs.map((cost) => ({
        id: this.rowString(cost.id),
        costType: this.rowString(cost.cost_type),
        amount: this.rowString(cost.amount),
        description: this.rowString(cost.description),
        incurredAt: this.rowString(cost.incurred_at),
      })),
      output: output
        ? {
            id: this.rowString(output.id),
            quantity: this.rowString(output.quantity),
            unitId: this.rowString(output.unit_id),
            approvedAt: typeof output.approved_at === 'string' ? output.approved_at : null,
          }
        : null,
      materialCost: formatDecimal(materialCost),
      additionalCost: formatDecimal(additionalCost),
      totalCost: formatDecimal(materialCost + additionalCost),
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
    await this.authRepository.writeAudit({
      actorUserId: actorId,
      action,
      entityType,
      entityId,
      beforeData: before === null ? null : JSON.stringify(before),
      afterData: after === null ? null : JSON.stringify(after),
      occurredAt,
    }, executor)
  }

  private rowString(value: unknown): string {
    if (typeof value !== 'string') {
      throw new ManufacturingError('A production record contains invalid data')
    }
    return value
  }

  private rowInteger(value: unknown): number {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 9) {
      throw new ManufacturingError('A production unit precision is invalid')
    }
    return parsed
  }
}
