import type { FlowEvent, MonthProjection, NewActual } from './types'

export function actualFromEvent(event: FlowEvent, note = ''): NewActual {
  return {
    event_key: event.id,
    cash_flow_id: event.cashFlowId ?? null,
    date: event.date,
    name: event.name,
    category: event.category,
    kind: event.kind,
    amount: Math.max(0, event.actualAmount ?? event.amount),
    account: event.account,
    note,
  }
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

/**
 * Minimal CSV import: date,name,amount columns. Rows are matched to planned
 * occurrences already in the forecast, so imported amounts keep stable keys.
 */
export function parseActualCsv(text: string, months: MonthProjection[]): { rows: NewActual[]; unmatched: string[] } {
  // Standalone recorded spends already represent themselves; only planned
  // occurrences can receive an imported actual.
  const events = months.flatMap((month) => month.events).filter((event) => event.source !== 'actual')
  const rows: NewActual[] = []
  const unmatched: string[] = []
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return { rows, unmatched }

  const first = parseCsvLine(lines[0]).map((cell) => cell.toLowerCase())
  const hasHeader = first.includes('date') && first.includes('amount')
  const dataLines = hasHeader ? lines.slice(1) : lines

  for (const line of dataLines) {
    const cells = parseCsvLine(line)
    const date = cells[0] ?? ''
    const name = cells[1] ?? ''
    const amount = Number(cells[2] ?? '')
    const normalizedName = name.trim().toLowerCase()
    const sameDay = events.filter((event) => event.date === date)
    const sameMonth = events.filter((event) => event.date.slice(0, 7) === date.slice(0, 7))
    const namesMatch = (event: FlowEvent): boolean => {
      if (!normalizedName) return false
      const eventName = event.name.toLowerCase()
      return eventName === normalizedName || eventName.includes(normalizedName) || normalizedName.includes(eventName)
    }
    // Monthly budgets land on the first of the month, so a real spend on any
    // day of that month still needs to find its plan.
    const match = sameDay.find(namesMatch)
      ?? sameDay.find((event) => event.category.toLowerCase() === normalizedName)
      ?? (!normalizedName ? sameDay[0] : undefined)
      ?? sameMonth.find(namesMatch)
      ?? sameMonth.find((event) => event.category.toLowerCase() === normalizedName)
    if (!match || !Number.isFinite(amount) || amount < 0) {
      unmatched.push(line)
      continue
    }
    rows.push({
      ...actualFromEvent(match),
      amount,
      note: 'Imported from CSV',
    })
  }

  return { rows, unmatched }
}
