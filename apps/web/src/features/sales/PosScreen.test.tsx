import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../shared/i18n'
import type { Sale, SalesProduct, SalesService } from './SalesService'
import { PosScreen } from './PosScreen'

const product: SalesProduct = {
  id: 'product-id',
  sku: 'WIDGET-1',
  name: 'Widget',
  baseUnitId: 'unit-id',
  baseUnitName: 'Piece',
  sellingPrice: '10',
  stock: '10',
  barcode: '01234',
  barcodeUnitId: null,
  units: [{
    id: 'unit-id',
    code: 'PC',
    name: 'Piece',
    decimalPlaces: 0,
    factorToBase: '1',
  }],
}

const receipt: Sale = {
  id: 'sale-id',
  branchId: 'branch-id',
  warehouseId: 'warehouse-id',
  customerId: 'customer-id',
  customerName: 'Customer',
  invoiceNumber: 'INV-000001',
  status: 'posted',
  subtotal: '20',
  discountTotal: '0',
  taxTotal: '0',
  taxRate: '0',
  taxMode: 'exclusive',
  total: '20',
  amountPaid: '20',
  amountRefunded: '0',
  returnedTotal: '0',
  outstandingBalance: '0',
  customerCredit: '0',
  notes: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  items: [],
  payments: [],
  returns: [],
}

let service: Pick<
  SalesService,
  'searchProducts' | 'listCustomers' | 'getTaxConfiguration' | 'createSale' | 'getSale'
>

beforeEach(async () => {
  await i18n.changeLanguage('en')
  service = {
    searchProducts: vi.fn().mockResolvedValue([product]),
    listCustomers: vi.fn().mockResolvedValue([{
      id: 'customer-id',
      code: 'CUS-1',
      name: 'Customer',
      phone: null,
      email: null,
    }]),
    getTaxConfiguration: vi.fn().mockResolvedValue({
      branchId: 'branch-id',
      taxRate: '0',
      taxMode: 'exclusive',
    }),
    createSale: vi.fn().mockResolvedValue('sale-id'),
    getSale: vi.fn().mockResolvedValue(receipt),
  }
})

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('ar')
})

describe('POS screen', () => {
  it('searches and scans products, edits a cart, collects payment, and shows its invoice', async () => {
    const user = userEvent.setup()
    render(
      <PosScreen
        salesService={service}
        actorId="user-id"
        branchId="branch-id"
        warehouseId="warehouse-id"
      />,
    )

    await user.clear(screen.getByRole('textbox', { name: /Search by name/ }))
    await user.type(screen.getByRole('textbox', { name: /Search by name/ }), '01234')
    await user.clear(await screen.findByRole('textbox', { name: 'Quantity' }))
    await user.type(screen.getByRole('textbox', { name: 'Quantity' }), '2')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Customer' }), 'customer-id')
    await user.type(screen.getByRole('textbox', { name: 'Payment amount' }), '20')
    await user.click(screen.getByRole('button', { name: 'Confirm sale' }))

    await waitFor(() => {
      expect(service.createSale).toHaveBeenCalledWith('user-id', {
        warehouseId: 'warehouse-id',
        customerId: 'customer-id',
        items: [{
          productId: 'product-id',
          unitId: 'unit-id',
          quantity: '2',
          unitPrice: '10',
          discount: '0',
        }],
        payments: [{ method: 'cash', amount: '20', reference: null }],
      })
    })
    expect(await screen.findByText('INV-000001')).toBeInTheDocument()
    expect(service.getSale).toHaveBeenCalledWith('user-id', 'sale-id')
  })

  it('surfaces local search failures instead of showing an empty success state', async () => {
    vi.mocked(service.searchProducts).mockRejectedValueOnce(
      new Error('Local database unavailable'),
    )
    render(
      <PosScreen
        salesService={service}
        actorId="user-id"
        branchId="branch-id"
        warehouseId="warehouse-id"
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Local database unavailable',
    )
  })
})
