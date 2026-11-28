import { budgetEventId, budgetPeriod, budgetStartDate, standaloneActualEventId } from './budgets'
import type { Actual, AppData, Budget, CashFlow } from './types'

export interface BudgetOnlyMigration {
  data: AppData
  changed: boolean
  addedBudgets: Budget[]
  updatedActuals: Actual[]
  clearedBudgetLinks: string[]
  deletedCashFlowIds: string[]
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizedName(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function monthlyEquivalent(flow: CashFlow): number {
  const amount = Math.max(0, Number(flow.amount) || 0)
  switch (flow.recurrence) {
    case 'monthly':
    case 'yearly':
    case 'one_time':
      return amount
    case 'every_n_months':
      return amount / Math.max(1, Number(flow.interval_count) || 1)
    case 'every_n_years':
      return amount / (12 * Math.max(1, Number(flow.interval_count) || 1))
    default:
      return amount
  }
}

function flowPeriod(flow: CashFlow): Budget['period'] {
  if (flow.recurrence === 'yearly') return 'yearly'
  if (flow.recurrence === 'one_time') return 'one_time'
  // every_n_months / every_n_years are represented as their monthly average.
  return 'monthly'
}

function budgetFromFlow(flow: CashFlow, userId: string): Budget {
  const period = flowPeriod(flow)
  return {
    id: makeId(),
    user_id: userId,
    category: flow.category || 'Other',
    name: flow.name || flow.category || 'Planned spend',
    monthly_limit: monthlyEquivalent(flow),
    rollover: period === 'monthly',
    period,
    start_date: flow.start_date || '1970-01-01',
    cash_flow_id: null,
  }
}

/** Standalone SMS spends keep their own record, but can replace a matching plan. */
function matchBudgetForActual(actual: Actual, budgets: Budget[]): Budget | null {
  const category = normalizedName(actual.category || 'Other')
  const candidates = budgets.filter((budget) => normalizedName(budget.category) === category)
  if (!candidates.length) return null

  const name = normalizedName(actual.name)
  if (name) {
    const exact = candidates.find((budget) => normalizedName(budget.name) === name)
    if (exact) return exact
    const partial = candidates.find((budget) => {
      const budgetName = normalizedName(budget.name)
      return Boolean(budgetName) && (budgetName.includes(name) || name.includes(budgetName))
    })
    if (partial) return partial
  }
  return candidates.length === 1 ? candidates[0] : null
}

function remapEventKey(budget: Budget | null, actual: Actual): string {
  if (!budget) return standaloneActualEventId(actual.id)
  const period = budgetPeriod(budget)
  const startDate = budgetStartDate(budget)
  if (period === 'monthly') return budgetEventId(budget, `${actual.date.slice(0, 7)}-01`)
  if (period === 'one_time') return budgetEventId(budget, startDate)

  const startMonth = Number(startDate.slice(5, 7)) - 1
  const startYear = Number(startDate.slice(0, 4)) || 1970
  const monthIndex = Number(actual.date.slice(5, 7)) - 1
  let year = Number(actual.date.slice(0, 4)) || startYear
  if (monthIndex < startMonth) year -= 1
  if (year < startYear) year = startYear
  const day = Number(startDate.slice(8, 10)) || 1
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  const date = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`
  return budgetEventId(budget, date)
}

/**
 * Moves every expense cash flow into the budget model. SMS rows are recorded
 * spends rather than plans, so only their actuals are kept. Recorded amounts are
 * re-keyed to the new budget occurrence ids before the old flows are dropped.
 */
export function planBudgetOnlyMigration(data: AppData): BudgetOnlyMigration {
  const budgets = [...(data.budgets ?? [])]
  const addedBudgets: Budget[] = []
  const updatedActuals = new Map<string, Actual>()
  const clearedBudgetLinks = new Set<string>()
  const deletedCashFlowIds = new Set<string>()
  // A budget occurrence can hold only one actual. Keep every original key
  // reserved so a remap never collides with another row during the sequential
  // Supabase updates in applyMigration().
  const usedEventKeys = new Set((data.actuals ?? []).map((actual) => actual.event_key))

  for (const flow of data.cashFlows ?? []) {
    if (flow.kind !== 'expense') continue
    const isSms = flow.source === 'sms'
    let budget = budgets.find((entry) => entry.cash_flow_id === flow.id)

    if (!budget && !isSms) {
      const period = flowPeriod(flow)
      const category = flow.category || 'Other'
      const name = flow.name || category
      const startDate = flow.start_date || '1970-01-01'
      budget = budgets.find((entry) => (
        budgetPeriod(entry) === period
        && budgetStartDate(entry) === startDate
        && entry.category === category
        && normalizedName(entry.name) === normalizedName(name)
      ))
      if (!budget) {
        budget = budgetFromFlow(flow, flow.user_id || data.profile.user_id)
        budgets.push(budget)
        addedBudgets.push(budget)
      }
    }

    if (budget && budget.cash_flow_id === flow.id) {
      const cleared = { ...budget, cash_flow_id: null }
      budgets[budgets.findIndex((entry) => entry.id === cleared.id)] = cleared
      budget = cleared
      clearedBudgetLinks.add(cleared.id)
    }

    for (const actual of data.actuals ?? []) {
      const belongsToFlow = actual.cash_flow_id === flow.id
        || actual.event_key === flow.id
        || actual.event_key.startsWith(`${flow.id}-`)
      if (!belongsToFlow) continue
      const matchedBudget = budget ?? (isSms
        ? matchBudgetForActual({ ...actual, category: actual.category || flow.category }, budgets)
        : null)
      let eventKey = remapEventKey(matchedBudget, actual)
      if (eventKey !== actual.event_key && usedEventKeys.has(eventKey)) {
        let suffix = 2
        let standaloneKey = standaloneActualEventId(actual.id)
        while (usedEventKeys.has(standaloneKey)) {
          standaloneKey = `${standaloneActualEventId(actual.id)}-${suffix}`
          suffix += 1
        }
        eventKey = standaloneKey
      }
      usedEventKeys.add(eventKey)
      const next = {
        ...actual,
        event_key: eventKey,
        cash_flow_id: null,
      }
      updatedActuals.set(actual.id, next)
    }
    deletedCashFlowIds.add(flow.id)
  }

  for (const budget of budgets) {
    if (!budget.cash_flow_id) continue
    clearedBudgetLinks.add(budget.id)
    budgets[budgets.findIndex((entry) => entry.id === budget.id)] = { ...budget, cash_flow_id: null }
  }

  const cashFlows = (data.cashFlows ?? []).filter((flow) => flow.kind !== 'expense')
  const cashFlowOverrides = (data.cashFlowOverrides ?? []).filter(
    (row) => !deletedCashFlowIds.has(row.cash_flow_id),
  )
  const cashFlowMoves = (data.cashFlowMoves ?? []).filter(
    (row) => !deletedCashFlowIds.has(row.cash_flow_id),
  )
  const cashFlowSkips = (data.cashFlowSkips ?? []).filter(
    (row) => !deletedCashFlowIds.has(row.cash_flow_id),
  )
  const actuals = (data.actuals ?? []).map((actual) => updatedActuals.get(actual.id) ?? actual)

  const changed = addedBudgets.length > 0
    || updatedActuals.size > 0
    || clearedBudgetLinks.size > 0
    || deletedCashFlowIds.size > 0
    || cashFlowOverrides.length !== (data.cashFlowOverrides ?? []).length
    || cashFlowMoves.length !== (data.cashFlowMoves ?? []).length
    || cashFlowSkips.length !== (data.cashFlowSkips ?? []).length

  return {
    data: {
      ...data,
      budgets,
      actuals,
      cashFlows,
      cashFlowOverrides,
      cashFlowMoves,
      cashFlowSkips,
    },
    changed,
    addedBudgets,
    updatedActuals: [...updatedActuals.values()],
    clearedBudgetLinks: [...clearedBudgetLinks],
    deletedCashFlowIds: [...deletedCashFlowIds],
  }
}
