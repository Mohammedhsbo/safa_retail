import { AccountingService } from '../../web/src/features/accounting/AccountingService.js'
import { Pbkdf2PasswordHasher } from '../../web/src/features/auth/PasswordHasher.js'
import { RoleManagementService } from '../../web/src/features/auth/RoleManagementService.js'
import { UserManagementService } from '../../web/src/features/auth/UserManagementService.js'
import { ProductCatalogService } from '../../web/src/features/catalog/ProductCatalogService.js'
import { InventoryService } from '../../web/src/features/inventory/InventoryService.js'
import { ManufacturingService } from '../../web/src/features/manufacturing/ManufacturingService.js'
import { BusinessConfigurationService } from '../../web/src/features/organization/BusinessConfigurationService.js'
import { OrganizationService } from '../../web/src/features/organization/OrganizationService.js'
import { PurchasesService } from '../../web/src/features/purchases/PurchasesService.js'
import { ReportsService } from '../../web/src/features/reports/ReportsService.js'
import { SalesService } from '../../web/src/features/sales/SalesService.js'
import { prisma } from './database.js'
import { PostgresDatabase } from './postgres-database.js'

export function createBusinessServices() {
  const database = new PostgresDatabase(prisma)
  const passwordHasher = new Pbkdf2PasswordHasher()
  return {
    accounting: new AccountingService(database),
    catalog: new ProductCatalogService(database),
    inventory: new InventoryService(database),
    manufacturing: new ManufacturingService(database),
    organization: new OrganizationService(database),
    businessConfiguration: new BusinessConfigurationService(database),
    purchases: new PurchasesService(database),
    reports: new ReportsService(database),
    sales: new SalesService(database),
    roles: new RoleManagementService(database),
    users: new UserManagementService(database, passwordHasher),
  }
}

export const exposedBusinessOperations = {
  accounting: [
    'listCustomers', 'createCustomer', 'updateCustomer', 'archiveCustomer',
    'getCustomerStatement', 'recordCustomerCollection', 'createCashbox',
    'listCashboxes', 'getCashboxMovements', 'archiveCashbox',
    'recordCashReceipt', 'recordCashDisbursement', 'transferCash',
    'createExpense', 'listExpenses',
  ],
  catalog: [
    'listCategories', 'createCategory', 'updateCategory', 'archiveCategory',
    'listBrands', 'createBrand', 'updateBrand', 'archiveBrand', 'listUnits',
    'initializeStandardUnits', 'createUnit', 'updateUnit', 'archiveUnit',
    'listProducts', 'getProduct', 'getProductByBarcode', 'createProduct',
    'updateProduct', 'setProductStatus', 'archiveProduct',
    'listProductsNotInWarehouse', 'assignProductToWarehouse',
  ],
  inventory: [
    'adjustStock', 'getBalance', 'listBalances', 'listMovements',
    'getValuation', 'createTransfer', 'submitTransfer', 'approveTransfer',
    'dispatchTransfer', 'receiveTransfer', 'cancelTransfer', 'getTransfer',
    'listTransfers', 'createStockCount', 'getStockCount', 'listStockCounts',
    'startStockCount', 'recordStockCount', 'approveStockCount', 'cancelStockCount',
  ],
  manufacturing: [
    'createOrder', 'listOrders', 'getOrder', 'planOrder', 'startOrder',
    'consumeMaterials', 'startStage', 'completeStage', 'addProductionCost',
    'completeOrder', 'approveFinishedGoods', 'cancelOrder',
  ],
  organization: [
    'getProfile', 'updateProfile', 'listBranches', 'listAccessibleBranches',
    'createBranch', 'updateBranch', 'archiveBranch', 'listWarehouses',
    'listAccessibleWarehouses', 'createWarehouse', 'updateWarehouse',
    'archiveWarehouse',
  ],
  businessConfiguration: ['listActivities', 'setActivityEnabled'],
  purchases: [
    'listSuppliers', 'createSupplier', 'updateSupplier', 'archiveSupplier',
    'createPurchase', 'receiveGoods', 'addSupplierPayment', 'returnPurchase',
    'getPurchase', 'listPurchases', 'getSupplierStatement',
  ],
  reports: ['getReports', 'exportExcel', 'exportPdf'],
  sales: [
    'searchProducts', 'listCustomers', 'getTaxConfiguration',
    'setTaxConfiguration', 'createSale', 'getSale', 'listSales',
    'cancelSale', 'returnSale',
  ],
  roles: ['listRoles', 'listPermissions', 'getRolePermissions', 'createRole', 'setPermissions'],
  users: ['listUsers', 'createUser', 'assignRoles', 'setUserAccess', 'setUserStatus', 'resetPassword'],
} as const
