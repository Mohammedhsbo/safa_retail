import { useCallback, useMemo, useState } from 'react'
import { FileSpreadsheet, FileText, Info, Printer, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { ToastError } from '../../shared/components/ToastError'
import {
  isAndroidApp,
  printAndroidPdf,
  saveAndShareAndroidFile,
} from '../../infrastructure/android/androidFileService'
import type { ReportBundle, ReportsService } from './ReportsService'

type ReportsDashboardProps = {
  reportsService: Pick<ReportsService, 'getReports' | 'exportExcel' | 'exportPdf'>
  actorId: string
}

type ReportTableProps = {
  title: string
  rows: ReportBundle[keyof Pick<
    ReportBundle,
    | 'salesAnalytics'
    | 'purchaseAnalytics'
    | 'expenseReport'
    | 'profitAndLoss'
    | 'inventoryReport'
    | 'lowStockReport'
    | 'customerBalances'
    | 'supplierBalances'
    | 'branchPerformance'
    | 'manufacturingReport'
  >]
}

const currentMonthRange = (): { fromDate: string; toDate: string } => {
  const today = new Date()
  const toDate = today.toISOString().slice(0, 10)
  const fromDate = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    1,
  )).toISOString().slice(0, 10)
  return { fromDate, toDate }
}

const formatLabel = (label: string): string =>
  label.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)

function ReportTable({ title, rows }: ReportTableProps) {
  const { t } = useTranslation()
  const columns = useMemo(() => {
    const first = rows[0]
    return first ? Object.keys(first) : []
  }, [rows])

  return (
    <Card as="article" className="overflow-hidden p-5">
      <h2 className="text-lg font-extrabold text-[var(--ink)]">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">{t('reports.noRecords')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-start text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                {columns.map((column) => (
                  <th className="px-3 py-2 text-start font-semibold" key={column}>
                    {t(`reports.columns.${column}`, { defaultValue: formatLabel(column) })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  className="border-b border-[var(--border)] last:border-0"
                  key={`${rowIndex}-${String(row[columns[0] ?? ''] ?? '')}`}
                >
                  {columns.map((column) => {
                    const value = row[column]
                    return (
                      <td className="px-3 py-2 text-[var(--ink)]" key={column}>
                        {column === 'warehouseTypes' && typeof value === 'string'
                          ? value.split(',').map((warehouseType) =>
                              t(`locations.warehouseTypes.${warehouseType}`),
                            ).join(', ')
                          : value === null ? '' : String(value)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function ReportsDashboard({
  reportsService,
  actorId,
}: ReportsDashboardProps) {
  const { t, i18n } = useTranslation()
  const [range, setRange] = useState(currentMonthRange)
  const [selectedBranch, setSelectedBranch] = useState('')
  const [reportState, setReportState] = useState<{
    actorId: string
    value: ReportBundle
  } | null>(null)
  const [branchState, setBranchState] = useState<{
    actorId: string
    values: Array<{ id: string; code: string; name: string }>
  } | null>(null)
  const report = reportState?.actorId === actorId ? reportState.value : null
  const accessibleBranches =
    branchState?.actorId === actorId ? branchState.values : []
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null)
  const [printing, setPrinting] = useState(false)

  const input = useMemo(() => ({
    ...range,
    ...(selectedBranch ? { branchId: selectedBranch } : {}),
  }), [range, selectedBranch])

  const salesTrend = useMemo(() => {
    if (!report) return []
    const totals = new Map<string, number>()
    for (const row of report.salesAnalytics) {
      const date = String(row.date ?? '')
      const netSales = Number(row.netSales ?? 0)
      if (date && Number.isFinite(netSales)) {
        totals.set(date, (totals.get(date) ?? 0) + netSales)
      }
    }
    return Array.from(totals, ([date, value]) => ({ date, value }))
      .sort((left, right) => left.date.localeCompare(right.date))
  }, [report])

  const expenseSlices = useMemo(() => {
    if (!report) return []
    const totals = new Map<string, number>()
    for (const row of report.expenseReport) {
      const category = String(row.category ?? '')
      const amount = Number(row.amount ?? 0)
      if (category && Number.isFinite(amount) && amount > 0) {
        totals.set(category, (totals.get(category) ?? 0) + amount)
      }
    }
    return Array.from(totals, ([category, value]) => ({ category, value }))
      .sort((left, right) => right.value - left.value)
  }, [report])

  const expenseTotal = expenseSlices.reduce((total, slice) => total + slice.value, 0)
  const expenseColors = ['#167a5b', '#e3a72f', '#3b82a0', '#8b5cf6', '#e76f51', '#64748b']
  const expenseGradient = expenseSlices.length > 0 && expenseTotal > 0
    ? `conic-gradient(${expenseSlices.reduce<{ angle: number; segments: string[] }>(
      (result, slice, index) => {
        const end = result.angle + (slice.value / expenseTotal) * 100
        return {
          angle: end,
          segments: [
            ...result.segments,
            `${expenseColors[index % expenseColors.length]} ${result.angle}% ${end}%`,
          ],
        }
      },
      { angle: 0, segments: [] },
    ).segments.join(', ')})`
    : undefined
  const maxSales = Math.max(0, ...salesTrend.map((point) => point.value))

  const loadReport = useCallback(async (filters: unknown) => {
    setLoading(true)
    setError('')
    try {
      const result = await reportsService.getReports(actorId, filters)
      setReportState({ actorId, value: result })
      setBranchState({ actorId, values: result.accessibleBranches })
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t('reports.loadFailed'),
      )
    } finally {
      setLoading(false)
    }
  }, [actorId, reportsService, t])

  const download = useCallback(async (format: 'excel' | 'pdf') => {
    setExporting(format)
    setError('')
    try {
      const bytes = format === 'excel'
        ? await reportsService.exportExcel(actorId, input)
        : await reportsService.exportPdf(actorId, input)
      const fileName = `safa-reports-${range.fromDate}-${range.toDate}.${format === 'excel' ? 'xlsx' : 'pdf'}`
      if (isAndroidApp()) {
        await saveAndShareAndroidFile(bytes, fileName)
      } else {
        const blob = new Blob([bytes.slice().buffer], {
          type: format === 'excel'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'application/pdf',
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
      }
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : t('reports.exportFailed'),
      )
    } finally {
      setExporting(null)
    }
  }, [actorId, input, range.fromDate, range.toDate, reportsService, t])

  const printPdf = useCallback(async () => {
    setPrinting(true)
    setError('')
    try {
      const bytes = await reportsService.exportPdf(actorId, input)
      await printAndroidPdf(
        bytes,
        `safa-reports-${range.fromDate}-${range.toDate}.pdf`,
      )
    } catch (printError) {
      setError(
        printError instanceof Error ? printError.message : t('reports.exportFailed'),
      )
    } finally {
      setPrinting(false)
    }
  }, [actorId, input, range.fromDate, range.toDate, reportsService, t])

  const sections = report ? [
    { key: 'salesAnalytics', title: t('reports.salesAnalytics') },
    { key: 'purchaseAnalytics', title: t('reports.purchaseAnalytics') },
    { key: 'expenseReport', title: t('reports.expenses') },
    { key: 'profitAndLoss', title: t('reports.profitAndLoss') },
    { key: 'inventoryReport', title: t('reports.inventory') },
    { key: 'lowStockReport', title: t('reports.lowStock') },
    { key: 'customerBalances', title: t('reports.customerBalances') },
    { key: 'supplierBalances', title: t('reports.supplierBalances') },
    { key: 'branchPerformance', title: t('reports.branchPerformance') },
    { key: 'manufacturingReport', title: t('reports.manufacturing') },
  ] as const : []

  return (
    <main className="min-h-screen bg-[var(--surface)] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-[var(--brand)]">
              {t('reports.eyebrow')}
            </p>
            <h1 className="mt-1 text-3xl font-black text-[var(--ink)]">
              {t('reports.title')}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {t('reports.description')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isAndroidApp() && (
              <Button
                disabled={!report || printing || exporting !== null}
                onClick={() => void printPdf()}
                variant="secondary"
              >
                <Printer aria-hidden="true" size={18} />
                {printing ? t('reports.printing') : t('reports.printPdf')}
              </Button>
            )}
            <Button
              disabled={!report || exporting !== null || printing}
              onClick={() => void download('excel')}
              variant="secondary"
            >
              <FileSpreadsheet aria-hidden="true" size={18} />
              {exporting === 'excel' ? t('reports.exporting') : t('reports.exportExcel')}
            </Button>
            <Button
              disabled={!report || exporting !== null || printing}
              onClick={() => void download('pdf')}
              variant="secondary"
            >
              <FileText aria-hidden="true" size={18} />
              {exporting === 'pdf' ? t('reports.exporting') : t('reports.exportPdf')}
            </Button>
          </div>
        </header>

        <Card as="section" className="p-5">
          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void loadReport(input)
            }}
          >
            <label className="grid gap-1 text-sm font-semibold text-[var(--ink)]">
              {t('reports.fromDate')}
              <input
                className="rounded-xl border border-[var(--border)] bg-white px-3 py-2"
                onChange={(event) =>
                  {
                    setReportState(null)
                    setRange((value) => ({ ...value, fromDate: event.target.value }))
                  }
                }
                required
                disabled={loading}
                type="date"
                value={range.fromDate}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-[var(--ink)]">
              {t('reports.toDate')}
              <input
                className="rounded-xl border border-[var(--border)] bg-white px-3 py-2"
                onChange={(event) =>
                  {
                    setReportState(null)
                    setRange((value) => ({ ...value, toDate: event.target.value }))
                  }
                }
                required
                disabled={loading}
                type="date"
                value={range.toDate}
              />
            </label>
            <label className="grid min-w-48 gap-1 text-sm font-semibold text-[var(--ink)]">
              {t('reports.branch')}
              <select
                className="rounded-xl border border-[var(--border)] bg-white px-3 py-2"
                disabled={loading}
                onChange={(event) => {
                  setReportState(null)
                  setSelectedBranch(event.target.value)
                }}
                value={selectedBranch}
              >
                <option value="">{t('reports.allAccessibleBranches')}</option>
                {accessibleBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={loading} type="submit">
              {loading ? t('reports.loading') : (
                <>
                  <RefreshCw aria-hidden="true" size={18} />
                  {t('reports.refresh')}
                </>
              )}
            </Button>
          </form>
        </Card>

        {error && (
          <>
          <ToastError error={error} />
          <p aria-live="assertive" className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">
            {error}
          </p>
          </>
        )}

        {!report && !loading && !error && (
          <p className="text-sm text-[var(--muted)]">{t('reports.prompt')}</p>
        )}

        {report && (
          <>
            <section aria-label={t('reports.dashboard')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(report.summary).map(([key, value]) => (
                <Card as="article" className="p-5" key={key}>
                  <p className="text-sm font-semibold text-[var(--muted)]">
                    {t(`reports.metrics.${key}`, { defaultValue: formatLabel(key) })}
                  </p>
                  <p className="mt-2 break-words text-2xl font-black text-[var(--ink)]">
                    {value}
                  </p>
                </Card>
              ))}
            </section>
            <section aria-label={t('reports.charts')} className="grid gap-4 lg:grid-cols-2">
              <Card as="article" className="min-w-0 p-5">
                <h2 className="text-lg font-extrabold text-[var(--ink)]">{t('reports.salesTrend')}</h2>
                {salesTrend.length === 0 ? (
                  <p className="mt-4 text-sm text-[var(--muted)]">{t('reports.noChartData')}</p>
                ) : (
                  <div aria-label={t('reports.salesTrendChart')} className="mt-5 flex min-h-56 items-end gap-2 overflow-x-auto border-b border-[var(--border)] pb-2" role="img">
                    {salesTrend.map((point) => {
                      const height = maxSales > 0 ? Math.max(4, (point.value / maxSales) * 160) : 4
                      return (
                        <div className="flex min-w-12 flex-1 flex-col items-center justify-end gap-2" key={point.date} title={`${point.date}: ${point.value.toLocaleString(i18n.language)}`}>
                          <span className="max-w-full truncate text-[10px] text-[var(--muted)]">{point.value.toLocaleString(i18n.language)}</span>
                          <div aria-hidden="true" className="w-full max-w-12 rounded-t-lg bg-[var(--brand)] transition-all" style={{ height }} />
                          <span className="text-[10px] text-[var(--muted)]">{point.date.slice(5)}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
              <Card as="article" className="min-w-0 p-5">
                <h2 className="text-lg font-extrabold text-[var(--ink)]">{t('reports.expenseBreakdown')}</h2>
                {expenseSlices.length === 0 || expenseTotal <= 0 ? (
                  <p className="mt-4 text-sm text-[var(--muted)]">{t('reports.noChartData')}</p>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-6 sm:justify-start">
                    <div aria-label={t('reports.expenseBreakdownChart')} className="grid size-44 shrink-0 place-items-center rounded-full" role="img" style={{ background: expenseGradient }}>
                      <span className="grid size-24 place-items-center rounded-full bg-white text-center text-xs font-bold text-[var(--muted)]">
                        {t('reports.expenses')}
                        <strong className="text-sm text-[var(--ink)]">{expenseTotal.toLocaleString(i18n.language)}</strong>
                      </span>
                    </div>
                    <ul className="min-w-40 flex-1 space-y-2">
                      {expenseSlices.map((slice, index) => (
                        <li className="flex items-center justify-between gap-3 text-sm" key={slice.category}>
                          <span className="flex min-w-0 items-center gap-2 text-[var(--ink)]">
                            <span aria-hidden="true" className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: expenseColors[index % expenseColors.length] }} />
                            <span className="truncate">{slice.category}</span>
                          </span>
                          <span className="shrink-0 font-semibold text-[var(--muted)]">{slice.value.toLocaleString(i18n.language)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            </section>
            <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <Info aria-hidden="true" size={16} />
              {t('reports.inventorySnapshotNotice')}
            </p>
            <section className="grid gap-4">
              {sections.map(({ key, title }) => (
                <ReportTable key={key} rows={report[key]} title={title} />
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
