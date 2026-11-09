import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  RetailApplicationServicesProvider,
  type RetailApplicationServices,
} from '../../app/RetailApplicationServices'
import { useSessionStore } from '../auth/session-store'
import { useWorkspaceStore } from '../../shared/state/workspace-store'
import { ConfirmDialogProvider } from '../../shared/components/ConfirmDialog'
import type { AuthenticatedUser } from '../auth/auth.types'
import i18n from '../../shared/i18n'
import type { Sale, SalesService } from './SalesService'
import {
  SaleDetailsScreen,
  SalesHistoryScreen,
  SalesReturnsScreen,
} from './SalesScreens'

const user: AuthenticatedUser = {
  id: 'user-id',
  username: 'operator',
  displayName: 'Operator',
  roleCodes: ['system_owner'],
  permissions: ['sales.read', 'sales.returns', 'sales.cancel'],
  branchIds: [],
  warehouseIds: [],
}

const sale: Sale = {
  id: 'sale-id',
  branchId: 'branch-id',
  warehouseId: 'warehouse-id',
  customerId: null,
  customerName: null,
  invoiceNumber: 'INV-000001',
  status: 'posted',
  subtotal: '20',
  discountTotal: '0',
  taxTotal: '0',
  taxRate: '0',
  taxMode: 'exclusive',
  additionalRate: '0',
  additionalTotal: '0',
  total: '20',
  amountPaid: '20',
  amountRefunded: '0',
  returnedTotal: '0',
  outstandingBalance: '0',
  customerCredit: '0',
  notes: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  items: [{
    id: 'sale-item-id',
    productId: 'product-id',
    sku: 'SKU-1',
    productName: 'Example item',
    unitId: 'unit-id',
    unitName: 'Piece',
    quantity: '2',
    unitPrice: '10',
    discountTotal: '0',
    taxTotal: '0',
    lineTotal: '20',
  }],
  payments: [],
  returns: [],
}

let service: Pick<SalesService, 'listSales' | 'getSale' | 'returnSale' | 'cancelSale'>
let services: RetailApplicationServices

function renderScreen(path: string, content: ReactNode) {
  return render(
    <RetailApplicationServicesProvider services={services}>
      <MemoryRouter initialEntries={[path]}>
        <ConfirmDialogProvider>
          <Routes>
            <Route path="/sales" element={<SalesHistoryScreen />} />
            <Route path="/sales/returns" element={<SalesReturnsScreen />} />
            <Route path="/sales/:saleId" element={content} />
          </Routes>
        </ConfirmDialogProvider>
      </MemoryRouter>
    </RetailApplicationServicesProvider>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  useSessionStore.setState({ user, startedAt: new Date().toISOString() })
  useWorkspaceStore.setState({ branchId: 'branch-id', warehouseId: 'warehouse-id' })
  service = {
    listSales: vi.fn().mockResolvedValue([sale]),
    getSale: vi.fn().mockResolvedValue(sale),
    returnSale: vi.fn().mockResolvedValue('return-id'),
    cancelSale: vi.fn().mockResolvedValue(undefined),
  }
  services = { sales: service } as RetailApplicationServices
})

afterEach(async () => {
  cleanup()
  useSessionStore.getState().clearSession()
  useWorkspaceStore.getState().clearWorkspace()
  vi.restoreAllMocks()
  await i18n.changeLanguage('ar')
})

describe('sales history, invoice and returns screens', () => {
  it('loads the authorized branch history and links invoices', async () => {
    renderScreen('/sales', <SalesHistoryScreen />)

    expect(await screen.findByRole('link', { name: /INV-000001/ })).toHaveAttribute(
      'href',
      '/sales/sale-id',
    )
    expect(service.listSales).toHaveBeenCalledWith('user-id', {
      branchId: 'branch-id',
      limit: 100,
      offset: 0,
    })
  })

  it('shows invoice details and cancels through the service', async () => {
    const userEventApi = userEvent.setup()
    renderScreen('/sales/sale-id', <SaleDetailsScreen />)

    expect(await screen.findByText(/Example item/)).toBeInTheDocument()
    await userEventApi.click(screen.getByRole('button', { name: 'Cancel invoice' }))
    await userEventApi.click(await screen.findByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      expect(service.cancelSale).toHaveBeenCalledWith('user-id', 'sale-id')
    })
  })

  it('submits a quantity-limited return and refund details', async () => {
    const userEventApi = userEvent.setup()
    renderScreen('/sales/returns?sale=sale-id', <SalesReturnsScreen />)

    await userEventApi.type(await screen.findByRole('textbox', { name: 'Reason for return' }), 'Damaged')
    await userEventApi.type(screen.getByPlaceholderText('Enter return quantity'), '1')
    const refundAmount = screen.getByRole('spinbutton', { name: 'Cash refund amount' })
    await userEventApi.clear(refundAmount)
    await userEventApi.type(refundAmount, '5')
    await userEventApi.click(screen.getByRole('button', { name: 'Record return' }))

    await waitFor(() => {
      expect(service.returnSale).toHaveBeenCalledWith('user-id', 'sale-id', {
        reason: 'Damaged',
        items: [{ saleItemId: 'sale-item-id', quantity: '1' }],
        refundAmount: '5',
        refundMethod: 'cash',
        refundReference: null,
      })
    })
  })
})
