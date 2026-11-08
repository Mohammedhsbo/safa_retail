import { strToU8, zipSync } from 'fflate'
import { jsPDF } from 'jspdf'
import type { ReportBundle } from './ReportsService'

type ExportRow = Record<string, string | number | null>

const xmlEscape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const columnName = (column: number): string => {
  let remainder = column
  let name = ''
  while (remainder > 0) {
    remainder -= 1
    name = String.fromCharCode(65 + (remainder % 26)) + name
    remainder = Math.floor(remainder / 26)
  }
  return name
}

const worksheetXml = (rows: readonly (readonly string[])[]): string => {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const address = `${columnName(columnIndex + 1)}${rowIndex + 1}`
      return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
}

const sheetName = (input: string, usedNames: Set<string>): string => {
  const base = input.replace(/[\\/:*?[\]]/g, ' ').trim().slice(0, 31) || 'Report'
  let name = base
  let suffix = 1
  while (usedNames.has(name)) {
    const ending = ` ${suffix++}`
    name = `${base.slice(0, 31 - ending.length)}${ending}`
  }
  usedNames.add(name)
  return name
}

const sheetRows = (
  title: string,
  rows: readonly ExportRow[],
): string[][] => {
  if (rows.length === 0) return [[title], ['No records']]
  const columns = Object.keys(rows[0] ?? {})
  return [
    columns,
    ...rows.map((row) =>
      columns.map((column) => {
        const value = row[column]
        return value === null || value === undefined ? '' : String(value)
      }),
    ),
  ]
}

export function generateExcel(report: ReportBundle): Uint8Array {
  const sections: Array<{ title: string; rows: string[][] }> = [
    {
      title: 'Dashboard',
      rows: [
        ['Report', report.title],
        ['From date', report.period.fromDate],
        ['To date', report.period.toDate],
        ['Branches', report.branches.map((branch) => branch.name).join(', ')],
        ['Inventory valuation', 'Current snapshot; not historical for the selected dates'],
        ['Metric', 'Value'],
        ...Object.entries(report.summary),
      ],
    },
    { title: 'Sales analytics', rows: sheetRows('Sales analytics', report.salesAnalytics) },
    { title: 'Purchase analytics', rows: sheetRows('Purchase analytics', report.purchaseAnalytics) },
    { title: 'Expenses', rows: sheetRows('Expenses', report.expenseReport) },
    { title: 'Profit and loss', rows: sheetRows('Profit and loss', report.profitAndLoss) },
    { title: 'Inventory', rows: sheetRows('Inventory', report.inventoryReport) },
    { title: 'Low stock', rows: sheetRows('Low stock', report.lowStockReport) },
    { title: 'Customer balances', rows: sheetRows('Customer balances', report.customerBalances) },
    { title: 'Supplier balances', rows: sheetRows('Supplier balances', report.supplierBalances) },
    { title: 'Branch performance', rows: sheetRows('Branch performance', report.branchPerformance) },
    { title: 'Manufacturing', rows: sheetRows('Manufacturing', report.manufacturingReport) },
  ]
  const names = new Set<string>()
  const worksheets = sections.map((section) => ({
    name: sheetName(section.title, names),
    content: worksheetXml(section.rows),
  }))
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${worksheets.map((_, index) =>
  `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
).join('')}
</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${worksheets.map((sheet, index) =>
  `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
).join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${worksheets.map((_, index) =>
  `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
).join('')}
</Relationships>`,
    ),
  }
  worksheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheet.content)
  })
  return zipSync(files, { level: 6 })
}

const readableValue = (value: string | number | null): string =>
  value === null ? '' : String(value)

export function generatePdf(report: ReportBundle): Uint8Array {
  const document = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const margin = 36
  const pageWidth = document.internal.pageSize.getWidth()
  const pageHeight = document.internal.pageSize.getHeight()
  const lineWidth = pageWidth - margin * 2
  let y = margin
  document.setFont('helvetica', 'bold')
  document.setFontSize(18)
  document.text(report.title, margin, y)
  y += 24
  document.setFont('helvetica', 'normal')
  document.setFontSize(9)
  document.text(
    `Period: ${report.period.fromDate} to ${report.period.toDate} | Branches: ${report.branches.map((branch) => branch.name).join(', ') || 'None'}`,
    margin,
    y,
  )
  y += 14
  document.text(
    'Inventory valuation is a current snapshot. Profit and loss revenue excludes sales tax.',
    margin,
    y,
  )
  y += 20

  const writeLine = (text: string, bold = false): void => {
    document.setFont('helvetica', bold ? 'bold' : 'normal')
    const wrapped = document.splitTextToSize(text, lineWidth) as string[]
    const requiredHeight = Math.max(12, wrapped.length * 11)
    if (y + requiredHeight > pageHeight - margin) {
      document.addPage()
      y = margin
    }
    document.text(wrapped, margin, y)
    y += requiredHeight
  }

  const writeSection = (title: string, rows: readonly ExportRow[]): void => {
    y += 6
    writeLine(title, true)
    if (rows.length === 0) {
      writeLine('No records')
      return
    }
    for (const row of rows) {
      writeLine(Object.entries(row)
        .map(([key, value]) => `${key}: ${readableValue(value)}`)
        .join(' | '))
    }
  }

  writeLine('Dashboard', true)
  for (const [key, value] of Object.entries(report.summary)) {
    writeLine(`${key}: ${value}`)
  }
  writeSection('Sales analytics', report.salesAnalytics)
  writeSection('Purchase analytics', report.purchaseAnalytics)
  writeSection('Expenses', report.expenseReport)
  writeSection('Profit and loss', report.profitAndLoss)
  writeSection('Inventory', report.inventoryReport)
  writeSection('Low stock', report.lowStockReport)
  writeSection('Customer balances', report.customerBalances)
  writeSection('Supplier balances', report.supplierBalances)
  writeSection('Branch performance', report.branchPerformance)
  writeSection('Manufacturing', report.manufacturingReport)
  return new Uint8Array(document.output('arraybuffer'))
}
