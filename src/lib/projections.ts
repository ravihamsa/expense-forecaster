import {
  budgetEventId,
  budgetOccurrenceDate,
  budgetPeriod,
  matchBudgetActuals,
  standaloneActualEventId,
} from './budgets'
import { fundAccountGoalId, goalFundAccountId } from './goals'
import { monthKey, monthYearLabel } from './format'
import { occurrencesInMonth } from './schedule'
import type {
  Actual,
  AppData,
  BudgetMove,
  CashFlowMove,
  CashFlowSkip,
  FlowEvent,
  Goal,
  Loan,
  LoanPayment,
  MonthProjection,
  SavingsEvent,
  Simulation,
  SimulationOptions,
} from './types'

const DEFAULT_OPTIONS: SimulationOptions = {
  expenseCutPct: 0,
  extraLoanPayment: 0,
  extraPaymentLoanId: 'highest_rate',
}

/** Categories that are reasonable to trim first when balancing a budget. */
export const DISCRETIONARY_CATEGORIES = new Set([
  'Shopping',
  'Entertainment',
  'Dining',
  'Subscriptions',
  'Travel',
  'Lifestyle',
  'Hobbies',
  'Other',
])

export function isDiscretionary(value: { category: string } | string): boolean {
  const category = typeof value === 'string' ? value : value.category
  return DISCRETIONARY_CATEGORIES.has(category)
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayInMonth(year: number, month: number, day: number): string {
  const lastDay = new Date(year, month + 1, 0).getDate()
  return dateKey(new Date(year, month, Math.max(1, Math.min(day || 1, lastDay))))
}

/**
 * Expected take-home for a given month. Explicit entries win; otherwise the most
 * recent earlier entry carries forward, with the legacy default as a last resort.
 */
export function expectedMonthlyIncome(data: AppData, month: string): number {
  const entries = data.monthlyIncomes ?? []
  const explicit = entries.find((entry) => entry.month === month)
  if (explicit) return Math.max(0, Number(explicit.amount) || 0)
  const previous = entries
    .filter((entry) => entry.month < month)
    .sort((a, b) => b.month.localeCompare(a.month))[0]
  if (previous) return Math.max(0, Number(previous.amount) || 0)
  return Math.max(0, Number(data.profile.monthly_income) || 0)
}

function monthOffset(value: string, from: Date): number {
  const [year, month] = value.split('-').map(Number)
  return (year - from.getFullYear()) * 12 + (month - 1) - from.getMonth()
}

/** Future lump-sum payments grouped by month offset from today. */
function futurePayments(payments: LoanPayment[], from: Date): Map<number, number> {
  const today = dateKey(from)
  const grouped = new Map<number, number>()
  payments
    .filter((payment) => payment.payment_date >= today && !payment.applied_to_balance)
    .forEach((payment) => {
      const offset = Math.max(0, monthOffset(payment.payment_date, from))
      grouped.set(offset, (grouped.get(offset) ?? 0) + payment.amount)
    })
  return grouped
}

export function loanPayoffMonths(loan: Loan, extraMonthly = 0, payments: LoanPayment[] = [], from = new Date()): number | null {
  let balance = Math.max(0, loan.outstanding)
  if (balance <= 0.005) return 0
  const rate = loan.interest_rate / 100 / 12
  const scheduled = futurePayments(payments.filter((payment) => payment.loan_id === loan.id), from)
  const extra = loan.direction === 'lent' ? 0 : Math.max(0, extraMonthly)
  const dueOffset = loan.due_date ? Math.max(0, monthOffset(loan.due_date, from)) : null

  if (loan.repayment_type === 'one_time') {
    let cumulative = 0
    for (let index = 0; index <= 600; index += 1) {
      cumulative += (scheduled.get(index) ?? 0) + extra
      if (cumulative >= balance) return index
      if (dueOffset !== null && index >= dueOffset) return dueOffset
    }
    return dueOffset
  }

  const payment = loan.emi + extra
  if (payment <= 0 && scheduled.size === 0) return null
  for (let month = 1; month <= 600; month += 1) {
    const interest = balance * rate
    const oneOff = scheduled.get(month - 1) ?? 0
    const pay = Math.min(payment + oneOff, balance + interest)
    balance = balance + interest - pay
    if (balance <= 0.005) return month
    if (pay <= interest && extra <= 0 && oneOff <= 0) return null
  }
  return null
}

export function loanTotalInterest(loan: Loan, extraMonthly = 0, payments: LoanPayment[] = [], from = new Date()): number {
  let balance = Math.max(0, loan.outstanding)
  if (balance <= 0.005) return 0
  let interestPaid = 0
  const rate = loan.interest_rate / 100 / 12
  const scheduled = futurePayments(payments.filter((payment) => payment.loan_id === loan.id), from)
  const extra = loan.direction === 'lent' ? 0 : Math.max(0, extraMonthly)
  const payment = (loan.repayment_type === 'emi' ? loan.emi : 0) + extra
  const dueOffset = loan.repayment_type === 'one_time' && loan.due_date
    ? Math.max(0, monthOffset(loan.due_date, from))
    : null

  for (let month = 1; month <= 600; month += 1) {
    const interest = balance * rate
    interestPaid += interest
    const oneOff = scheduled.get(month - 1) ?? 0
    let pay = Math.min(payment + oneOff, balance + interest)
    if (dueOffset !== null && month - 1 >= dueOffset) pay = balance + interest
    balance = balance + interest - pay
    if (balance <= 0.005) break
    if (payment <= 0 && oneOff <= 0 && dueOffset === null && extra <= 0) break
  }
  return interestPaid
}

export function simulate(data: AppData, options: SimulationOptions = DEFAULT_OPTIONS, from = new Date()): Simulation {
  const {
    profile,
    accounts = [],
    transfers = [],
    cashFlows = [],
    cashFlowOverrides = [],
    cashFlowMoves = [],
    cashFlowSkips = [],
    budgetMoves = [],
    actuals = [],
    budgets = [],
    goals = [],
    loans = [],
    loanPayments = [],
  } = data
  const horizon = Math.max(1, Math.min(36, profile.horizon_months || 12))
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const growth = Math.max(-50, profile.income_growth_pct || 0) / 100
  const inflation = Math.max(-50, profile.expense_inflation_pct || 0) / 100
  const today = dateKey(from)

  // Planned spends come only from budgets. Cash flows still carry income and
  // calendar overrides; expense cash flows are migrated into budgets on load.
  const spendableCategories = budgets.map((budget) => budget.category)
  const hasDiscretionary = spendableCategories.some(isDiscretionary)
  const cutRate = Math.max(0, Math.min(100, opts.expenseCutPct)) / 100

  const overrides = new Map<string, number>()
  ;(cashFlowOverrides ?? []).forEach((override) => {
    overrides.set(`${override.cash_flow_id}|${override.month}`, Math.max(0, Number(override.amount) || 0))
  })
  const moves = new Map<string, CashFlowMove>()
  ;(cashFlowMoves ?? []).forEach((move) => {
    moves.set(`${move.cash_flow_id}|${move.from_date}`, move)
  })
  const skips = new Set(
    (cashFlowSkips ?? []).map((skip: CashFlowSkip) => `${skip.cash_flow_id}|${skip.date}`),
  )
  const budgetMovesByKey = new Map<string, BudgetMove>()
  ;(budgetMoves ?? []).forEach((move) => {
    budgetMovesByKey.set(`${move.budget_id}|${move.from_date}`, move)
  })
  const actualsByKey = new Map<string, Actual>()
  ;(actuals ?? []).forEach((actual) => {
    actualsByKey.set(actual.event_key, actual)
  })
  const usedActualIds = new Set<string>()
  const budgetCarry = new Map<string, number>()

  const balances = new Map<string, number>()
  loans.forEach((loan) => balances.set(loan.id, Math.max(0, loan.outstanding)))

  // Every money account carries its own running balance. The aggregate numbers
  // are the sum of these buckets, so adding an account never double-counts.
  const accountBalances: Record<string, number> = {}
  accounts.forEach((account) => {
    accountBalances[account.id] = Math.max(0, Number(account.opening_balance) || 0)
  })
  if (accounts.length === 0) accountBalances.bank = Math.max(0, profile.opening_balance || 0)
  if (accountBalances.bank === undefined) accountBalances.bank = 0
  if (accountBalances.cash === undefined) accountBalances.cash = 0

  // Savings funds are destination accounts. A fund with no real account gets a
  // virtual one, opened with the amount already saved minus recorded transfers.
  const fundAccounts = new Map<string, Goal>()
  goals.forEach((goal) => fundAccounts.set(goalFundAccountId(goal, accounts), goal))
  const recordedFundTotals = new Map<string, number>()
  const recordedFundByMonth = new Map<string, number>()
  ;(transfers ?? []).forEach((transfer) => {
    const goalId = fundAccountGoalId(transfer.to_account, goals, accounts)
    if (!goalId) return
    const amount = Math.max(0, Number(transfer.amount) || 0)
    if (amount <= 0) return
    recordedFundTotals.set(goalId, (recordedFundTotals.get(goalId) ?? 0) + amount)
    const offset = monthOffset(transfer.date, from)
    if (Number.isInteger(offset) && offset >= 0 && offset < horizon) {
      const key = `${goalId}|${offset}`
      recordedFundByMonth.set(key, (recordedFundByMonth.get(key) ?? 0) + amount)
    }
  })
  fundAccounts.forEach((goal, accountId) => {
    if (accountBalances[accountId] !== undefined) return
    const alreadySaved = Math.max(0, Number(goal.current_amount) || 0)
    const recorded = recordedFundTotals.get(goal.id) ?? 0
    accountBalances[accountId] = Math.max(0, alreadySaved - recorded)
  })
  const openingTotal = Object.values(accountBalances).reduce((sum, value) => sum + value, 0)

  const transfersByMonth = new Map<number, { from: string; to: string; amount: number }[]>()
  transfers.forEach((transfer) => {
    const amount = Math.max(0, Number(transfer.amount) || 0)
    if (amount <= 0 || transfer.from_account === transfer.to_account) return
    const offset = monthOffset(transfer.date, from)
    if (!Number.isInteger(offset) || offset < 0 || offset >= horizon) return
    const list = transfersByMonth.get(offset) ?? []
    list.push({ from: transfer.from_account, to: transfer.to_account, amount })
    transfersByMonth.set(offset, list)
  })

  const paymentsByLoan = new Map<string, LoanPayment[]>()
  loanPayments
    .filter((payment) => payment.payment_date >= today || payment.applied_to_balance)
    .forEach((payment) => {
      const list = paymentsByLoan.get(payment.loan_id) ?? []
      list.push(payment)
      paymentsByLoan.set(payment.loan_id, list)
    })

  const months: MonthProjection[] = []
  let runningBalance = openingTotal
  let totalIncome = 0
  let totalExpenses = 0
  let totalLoanPayments = 0
  let totalLoanInflows = 0
  let totalInterest = 0
  let deficitMonths = 0
  let surplusMonths = 0
  let totalDeficit = 0
  let lowestBalance = runningBalance
  let lowestSpendable = runningBalance
  const payoffMap = new Map<string, { loanId: string; name: string; monthIndex: number; label: string }>()

  function markPaidOff(loan: Loan, opening: number, closing: number, index: number, year: number, month: number) {
    if (opening > 0.005 && closing <= 0.005 && !payoffMap.has(loan.id)) {
      payoffMap.set(loan.id, {
        loanId: loan.id,
        name: loan.name,
        monthIndex: index,
        label: monthYearLabel(year, month),
      })
    }
  }

  // Cash-flow occurrences are bucketed by the month they actually land in, so a
  // date move in the calendar shifts the money (and the carried balance) between months.
  interface PlannedBucket {
    events: FlowEvent[]
    income: number
    expenses: number
    /** Signed change to each money account in the month the event lands in. */
    deltas: Record<string, number>
  }
  const buckets: PlannedBucket[] = Array.from(
    { length: horizon },
    () => ({ events: [], income: 0, expenses: 0, deltas: {} }),
  )
  const addDelta = (target: Record<string, number>, id: string | undefined, amount: number): void => {
    const key = id && accountBalances[id] !== undefined ? id : 'bank'
    target[key] = (target[key] ?? 0) + amount
  }

  // Recorded spends are paired with budgets before either is added to a month,
  // so one Groceries spend replaces the Groceries plan instead of doubling it.
  const budgetMonthViews = buckets.map((bucket, i) => {
    const date = new Date(from.getFullYear(), from.getMonth() + i, 1)
    return {
      key: monthKey(date.getFullYear(), date.getMonth()),
      year: date.getFullYear(),
      monthIndex: date.getMonth(),
      events: bucket.events,
    }
  })
  const budgetMatches = matchBudgetActuals(data, budgetMonthViews)

  for (let i = 0; i < horizon; i += 1) {
    const date = new Date(from.getFullYear(), from.getMonth() + i, 1)
    const year = date.getFullYear()
    const month = date.getMonth()
    const currentKey = monthKey(year, month)
    const factor = Math.pow(1 + growth, i / 12)
    const inflationFactor = Math.pow(1 + inflation, i / 12)

    const incomeEntry = (data.monthlyIncomes ?? []).find((entry) => entry.month === currentKey)
    // A month you explicitly planned is fixed; inherited/default income still grows.
    const income = Math.max(0, expectedMonthlyIncome(data, currentKey) * (incomeEntry ? 1 : factor))
    const incomeDate = dayInMonth(year, month, incomeEntry?.day ?? 1)
    const incomeEventId = `income-${currentKey}`
    const incomeActual = actualsByKey.get(incomeEventId)
    buckets[i].income += income
    addDelta(buckets[i].deltas, 'bank', income)
    // Always include this row so expected income can be set even before it exists.
    buckets[i].events.push({
      id: incomeEventId,
      name: 'Monthly income',
      kind: 'income',
      amount: income,
      category: 'Income',
      account: 'bank',
      source: 'profile',
      monthlyIncomeId: incomeEntry?.id,
      date: incomeDate,
      sourceMonth: currentKey,
      originalDate: dayInMonth(year, month, 1),
      canMove: true,
      moved: Boolean(incomeEntry?.day && incomeEntry.day !== 1),
      actualAmount: incomeActual?.amount,
      actualId: incomeActual?.id,
    })

    // Income still comes from cash flows. Expense cash flows have been migrated
    // into budgets; keeping them here would duplicate every planned spend.
    for (const flow of cashFlows) {
      if (flow.kind !== 'income') continue
      const dates = occurrencesInMonth(flow, year, month)
      if (!dates.length) continue
      const inflated = flow.amount * inflationFactor
      const fixedAmount = overrides.get(`${flow.id}|${currentKey}`)
      for (const occurrence of dates) {
        const originalDate = dateKey(occurrence)
        if (skips.has(`${flow.id}|${originalDate}`)) continue
        const move = moves.get(`${flow.id}|${originalDate}`)
        const targetDate = move?.to_date || originalDate
        const targetIndex = monthOffset(targetDate, from)
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= horizon) continue
        const amount = fixedAmount !== undefined ? fixedAmount : inflated
        const eventId = `${flow.id}-${occurrence.getTime()}`
        const actual = actualsByKey.get(eventId)
        const eventAccount = flow.account || 'bank'
        buckets[targetIndex].events.push({
          id: eventId,
          name: flow.name,
          kind: 'income',
          amount,
          category: flow.category,
          account: eventAccount,
          source: 'cash_flow',
          cashFlowId: flow.id,
          date: targetDate,
          sourceMonth: currentKey,
          originalDate,
          moveId: move?.id,
          overridden: fixedAmount !== undefined,
          canMove: true,
          moved: Boolean(move && move.to_date !== originalDate),
          actualAmount: actual?.amount,
          actualId: actual?.id,
        })
        buckets[targetIndex].income += amount
        addDelta(buckets[targetIndex].deltas, eventAccount, amount)
      }
    }

    // Budgets are the only future spend source. Unused monthly amounts and
    // overspends carry forward only when that budget's rollover toggle is on.
    for (const budget of budgets) {
      const occurrence = budgetOccurrenceDate(budget, { key: currentKey, year, monthIndex: month })
      if (!occurrence) continue
      const period = budgetPeriod(budget)
      const limit = Math.max(0, Number(budget.monthly_limit) || 0)
      const eventId = budgetEventId(budget, occurrence)
      const eventActuals = budgetMatches.byEventId.get(eventId) ?? []
      const hasActual = eventActuals.length > 0
      const recorded = eventActuals.reduce(
        (sum, item) => sum + Math.max(0, Number(item.amount) || 0),
        0,
      )
      for (const actual of eventActuals) usedActualIds.add(actual.id)
      const cut = hasDiscretionary ? (isDiscretionary(budget.category) ? 1 - cutRate : 1) : 1 - cutRate
      const plannedBase = limit * inflationFactor * cut
      let eventAmount = 0

      if (period === 'monthly') {
        const carry = budget.rollover
          ? Math.max(-limit * 12, budgetCarry.get(budget.id) ?? 0)
          : 0
        if (hasActual) {
          // Recorded spends replace the placeholder, and their difference from
          // the budget becomes the next month's carry.
          const available = Math.max(0, limit + carry)
          eventAmount = recorded
          budgetCarry.set(budget.id, budget.rollover ? available - recorded : 0)
        } else {
          // Positive carry stays available until it is actually spent. Negative
          // carry is absorbed by future allocations until it is worked off.
          eventAmount = Math.max(0, plannedBase + Math.min(0, carry)) + Math.max(0, carry)
          const nextCarry = carry < 0
            ? Math.min(0, carry + plannedBase)
            : carry
          budgetCarry.set(budget.id, budget.rollover ? nextCarry : 0)
        }
      } else {
        eventAmount = hasActual ? recorded : plannedBase
      }
      if (eventAmount <= 0.005 && !hasActual) continue

      // A calendar move changes where the occurrence appears, not its identity:
      // recorded amounts stay attached to the original budget event id.
      const moved = budgetMovesByKey.get(`${budget.id}|${occurrence}`)
      const eventDate = moved?.to_date ?? occurrence
      const targetIndex = moved ? monthOffset(eventDate, from) : i
      if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= horizon) continue
      const targetBucket = buckets[targetIndex]

      targetBucket.events.push({
        id: eventId,
        name: budget.name?.trim() || budget.category,
        kind: 'expense',
        amount: eventAmount,
        category: budget.category,
        account: 'bank',
        source: 'budget',
        budgetId: budget.id,
        date: eventDate,
        sourceMonth: eventDate.slice(0, 7),
        moveId: moved?.id,
        originalDate: occurrence,
        actualAmount: hasActual ? recorded : undefined,
        actualId: eventActuals[0]?.id,
        canMove: true,
        moved: Boolean(moved),
      })
      targetBucket.expenses += eventAmount
      addDelta(targetBucket.deltas, 'bank', -eventAmount)
    }
  }

  for (let i = 0; i < horizon; i += 1) {
    // Recorded spends with no plan still move money, but they are not future
    // plans and never appear as a budgeted amount.
    for (const actual of actuals) {
      if (usedActualIds.has(actual.id) || budgetMatches.matchedIds.has(actual.id) || actual.kind !== 'expense') continue
      if (monthOffset(actual.date, from) !== i) continue
      const amount = Math.max(0, Number(actual.amount) || 0)
      if (amount <= 0) continue
      buckets[i].events.push({
        id: standaloneActualEventId(actual.id),
        name: actual.name || actual.category || 'Recorded spend',
        kind: 'expense',
        amount,
        category: actual.category || 'Other',
        account: actual.account || 'bank',
        source: 'actual',
        date: actual.date,
        actualAmount: amount,
        actualId: actual.id,
        canMove: true,
      })
      buckets[i].expenses += amount
      addDelta(buckets[i].deltas, actual.account, -amount)
    }
  }

  for (let i = 0; i < horizon; i += 1) {
    const date = new Date(from.getFullYear(), from.getMonth() + i, 1)
    const year = date.getFullYear()
    const month = date.getMonth()
    const currentKey = monthKey(year, month)
    const events: MonthProjection['events'] = [...buckets[i].events]
    let income = buckets[i].income
    let expenses = buckets[i].expenses
    const deltas: Record<string, number> = { ...buckets[i].deltas }

    let loanOutflow = 0
    let loanInflow = 0
    const activeLoans = loans
      .filter((loan) => (balances.get(loan.id) ?? 0) > 0.005)
      .sort((a, b) => b.interest_rate - a.interest_rate)

    for (const loan of activeLoans) {
      const isLent = loan.direction === 'lent'
      const flowKind = isLent ? 'income' : 'expense'
      const opening = balances.get(loan.id) ?? 0
      const interest = opening * (loan.interest_rate / 100 / 12)
      let balance = opening + interest
      if (!isLent) totalInterest += interest
      let cashMoved = 0

      if (loan.repayment_type === 'emi' && loan.emi > 0) {
        const emi = Math.min(loan.emi, balance)
        balance -= emi
        cashMoved += emi
        const emiAccount = loan.account || 'bank'
        events.push({
          id: `${loan.id}-emi-${i}`,
          name: isLent ? `${loan.name} repayment received` : `${loan.name} EMI`,
          kind: flowKind,
          amount: emi,
          category: 'Loans',
          account: emiAccount,
          source: 'loan',
          date: dayInMonth(year, month, loan.due_day),
        })
        addDelta(deltas, emiAccount, isLent ? emi : -emi)
      }

      const scheduledPayments = paymentsByLoan.get(loan.id) ?? []
      scheduledPayments
        .filter((payment) => payment.payment_date.slice(0, 7) === currentKey)
        .forEach((payment, index) => {
          // Applied payments already reduced loan.outstanding when recorded —
          // show the cash flow, but don't reduce the simulated balance twice.
          const amount = payment.applied_to_balance
            ? payment.amount
            : Math.min(payment.amount, balance)
          if (amount <= 0) return
          cashMoved += amount
          if (!payment.applied_to_balance) balance -= amount
          const paymentAccount = payment.account || loan.account || 'bank'
          events.push({
            id: `${loan.id}-payment-${payment.id}-${index}`,
            name: isLent
              ? `${loan.name} repayment received${payment.note ? ` · ${payment.note}` : ''}`
              : `${loan.name} payment${payment.note ? ` · ${payment.note}` : ''}`,
            kind: flowKind,
            amount,
            category: 'Loans',
            account: paymentAccount,
            source: 'loan',
            date: payment.payment_date,
          })
          addDelta(deltas, paymentAccount, isLent ? amount : -amount)
        })

      if (loan.repayment_type === 'one_time' && loan.due_date?.slice(0, 7) === currentKey && balance > 0) {
        const lumpAccount = loan.account || 'bank'
        events.push({
          id: `${loan.id}-lumpsum-${i}`,
          name: isLent ? `${loan.name} repayment received` : `${loan.name} lump-sum repayment`,
          kind: flowKind,
          amount: balance,
          category: 'Loans',
          account: lumpAccount,
          source: 'loan',
          date: loan.due_date ?? dayInMonth(year, month, 1),
        })
        cashMoved += balance
        addDelta(deltas, lumpAccount, isLent ? balance : -balance)
        balance = 0
      }

      balances.set(loan.id, Math.max(0, balance))
      if (isLent) loanInflow += cashMoved
      else loanOutflow += cashMoved
      markPaidOff(loan, opening, balance, i, year, month)
    }

    let extraPayment = 0
    const extraBudget = Math.max(0, opts.extraLoanPayment)
    const remainingLoans = loans.filter(
      (loan) => loan.direction === 'borrowed' && (balances.get(loan.id) ?? 0) > 0.005,
    )
    if (extraBudget > 0 && remainingLoans.length) {
      const targets = [...remainingLoans].sort((a, b) => b.interest_rate - a.interest_rate)
      if (opts.extraPaymentLoanId !== 'highest_rate') {
        const preferredIdx = targets.findIndex((loan) => loan.id === opts.extraPaymentLoanId)
        if (preferredIdx > -1) {
          const [preferred] = targets.splice(preferredIdx, 1)
          targets.unshift(preferred)
        }
      }
      let remaining = extraBudget
      for (const loan of targets) {
        if (remaining <= 0.005) break
        const opening = balances.get(loan.id) ?? 0
        const pay = Math.min(remaining, opening)
        if (pay <= 0) continue
        const closing = opening - pay
        balances.set(loan.id, closing)
        remaining -= pay
        extraPayment += pay
        const prepayAccount = loan.account || 'bank'
        events.push({
          id: `${loan.id}-extra-${i}`,
          name: `${loan.name} prepayment`,
          kind: 'expense',
          amount: pay,
          category: 'Loans',
          account: prepayAccount,
          source: 'extra_payment',
          date: dayInMonth(year, month, loan.due_day),
        })
        addDelta(deltas, prepayAccount, -pay)
        markPaidOff(loan, opening, closing, i, year, month)
      }
    }

    // Savings-fund contributions are planned transfers: they leave spendable
    // cash and grow the fund, without changing total net worth.
    const savingsEvents: SavingsEvent[] = []
    let savingsContributions = 0
    for (const [fundAccount, goal] of fundAccounts) {
      const monthly = Math.max(0, Number(goal.monthly_contribution) || 0)
      const target = Math.max(0, Number(goal.target_amount) || 0)
      const fundBalance = accountBalances[fundAccount] ?? 0
      const remaining = Math.max(0, target - fundBalance)
      if (monthly <= 0 || remaining <= 0) continue
      const recorded = recordedFundByMonth.get(`${goal.id}|${i}`) ?? 0
      const planned = Math.min(
        Math.max(0, monthly - recorded),
        Math.max(0, remaining - recorded),
      )
      if (planned <= 0.005) continue
      const source = accountBalances.bank !== undefined ? 'bank' : 'cash'
      addDelta(deltas, source, -planned)
      addDelta(deltas, fundAccount, planned)
      savingsContributions += planned
      savingsEvents.push({
        id: `savings-${goal.id}-${i}`,
        goalId: goal.id,
        name: goal.name,
        amount: planned,
        date: dayInMonth(year, month, 1),
        from_account: source,
        to_account: fundAccount,
      })
    }

    // Transfers are net-neutral: they only move money between account buckets.
    ;(transfersByMonth.get(i) ?? []).forEach((transfer) => {
      addDelta(deltas, transfer.from, -transfer.amount)
      addDelta(deltas, transfer.to, transfer.amount)
    })
    Object.entries(deltas).forEach(([id, delta]) => {
      accountBalances[id] = (accountBalances[id] ?? 0) + delta
    })

    const net = income + loanInflow - expenses - loanOutflow - extraPayment
    const openingBalance = runningBalance
    const closingBalance = Object.values(accountBalances).reduce((sum, value) => sum + value, 0)
    const fundBalances: Record<string, number> = {}
    let fundTotal = 0
    fundAccounts.forEach((_goal, accountId) => {
      const balance = Math.max(0, accountBalances[accountId] ?? 0)
      fundBalances[accountId] = balance
      fundTotal += balance
    })
    const spendableBalance = closingBalance - fundTotal
    runningBalance = closingBalance
    lowestSpendable = Math.min(lowestSpendable, spendableBalance)
    const monthAccountBalances = { ...accountBalances }

    const loanBalances: Record<string, number> = {}
    balances.forEach((balance, id) => {
      loanBalances[id] = Math.max(0, balance)
    })

    months.push({
      key: currentKey,
      label: date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      monthLabel: monthYearLabel(year, month),
      year,
      monthIndex: month,
      income,
      expenses,
      loanPayments: loanOutflow + extraPayment,
      loanInflows: loanInflow,
      net,
      openingBalance,
      closingBalance,
      accountBalances: monthAccountBalances,
      fundBalances,
      spendableBalance,
      savingsContributions,
      savingsEvents,
      cumulativeNet: closingBalance - openingTotal,
      events,
      activeLoans: activeLoans.length,
      loanBalances,
      paidOffLoans: Array.from(payoffMap.values())
        .filter((p) => p.monthIndex === i)
        .map((p) => p.loanId),
      extraPayment,
    })

    totalIncome += income
    totalExpenses += expenses
    totalLoanPayments += loanOutflow + extraPayment
    totalLoanInflows += loanInflow
    if (net < 0) {
      deficitMonths += 1
      totalDeficit += Math.abs(net)
    } else {
      surplusMonths += 1
    }
    lowestBalance = Math.min(lowestBalance, closingBalance)
  }

  return {
    months,
    totalIncome,
    totalExpenses,
    totalLoanPayments,
    totalLoanInflows,
    totalInterest,
    deficitMonths,
    surplusMonths,
    totalDeficit,
    endingBalance: runningBalance,
    endingSpendable: months.length ? months[months.length - 1].spendableBalance : 0,
    lowestBalance,
    lowestSpendable,
    accountBalances: { ...accountBalances },
    payoff: Array.from(payoffMap.values()).sort((a, b) => a.monthIndex - b.monthIndex),
  }
}
