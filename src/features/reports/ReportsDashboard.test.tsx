import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../shared/i18n'
import type { ReportBundle, ReportsService } from './ReportsService'
import { ReportsDashboard } from './ReportsDashboard'

const report: ReportBundle = {
  title: 'Business reports',
  period: { fromDate: '2026-11-01', toDate: '2026-11-05' },
  branches: [{ id: 'branch-1', code: 'NORTH', name: 'North Branch' }],
  accessibleBranches: [
    { id: 'branch-1', code: 'NORTH', name: 'North Branch' },
    { id: 'branch-2', code: 'SOUTH', name: 'South Branch' },
  ],
  summary: { netProfit: '120.50' },
  salesAnalytics: [{
    branch: 'North Branch',
    date: '2026-11-05',
    grossSales: '220',
    netSales: '200',
  }],
  purchaseAnalytics: [],
  expenseReport: [{
    branch: 'North Branch',
    date: '2026-11-05',
    category: 'Rent',
    description: 'Store rent',
    amount: '50',
  }],
  profitAndLoss: [],
  inventoryReport: [],
  lowStockReport: [],
  customerBalances: [],
  supplierBalances: [],
  branchPerformance: [],
  manufacturingReport: [],
}

function createService() {
  return {
    getReports: vi.fn(async () => report),
    exportExcel: vi.fn(async () => new Uint8Array([1, 2, 3])),
    exportPdf: vi.fn(async () => new Uint8Array([4, 5, 6])),
  } satisfies Pick<ReportsService, 'getReports' | 'exportExcel' | 'exportPdf'>
}

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  await i18n.changeLanguage('ar')
})

describe('reports dashboard', () => {
  it('loads scoped reports, renders KPIs and tables, and refreshes the selected filters', async () => {
    await i18n.changeLanguage('en')
    const user = userEvent.setup()
    const reportsService = createService()
    render(<ReportsDashboard actorId="user-1" reportsService={reportsService} />)

    expect(screen.getByRole('heading', { name: 'Business dashboard and reports' }))
      .toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh reports' }))
    await screen.findByText('Net profit')
    expect(screen.getByText('Net profit')).toBeInTheDocument()
    expect(screen.getByText('120.50')).toBeInTheDocument()
    expect(screen.getByText('220')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Daily net sales bar chart' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Pie chart of expenses by category' })).toBeInTheDocument()
    expect(screen.getAllByText('Rent')).toHaveLength(2)
    expect(reportsService.getReports).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ fromDate: expect.any(String), toDate: expect.any(String) }),
    )

    await user.selectOptions(screen.getByLabelText('Branch'), 'branch-2')
    fireEvent.change(screen.getByLabelText('From date'), {
      target: { value: '2026-11-01' },
    })
    await user.click(screen.getByRole('button', { name: 'Refresh reports' }))
    await waitFor(() => {
      expect(reportsService.getReports).toHaveBeenLastCalledWith(
        'user-1',
        expect.objectContaining({
          fromDate: '2026-11-01',
          branchId: 'branch-2',
        }),
      )
    })
  })

  it('downloads the generated XLSX and PDF bytes', async () => {
    await i18n.changeLanguage('en')
    const user = userEvent.setup()
    const reportsService = createService()
    const createObjectURL = vi.fn(() => 'blob:report')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ReportsDashboard actorId="user-1" reportsService={reportsService} />)
    await user.click(screen.getByRole('button', { name: 'Refresh reports' }))
    await screen.findByText('Net profit')

    await user.click(screen.getByRole('button', { name: 'Export Excel' }))
    await waitFor(() => expect(reportsService.exportExcel).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Export PDF' }))
    await waitFor(() => expect(reportsService.exportPdf).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(2))
    expect(click).toHaveBeenCalledTimes(2)
  })
})
