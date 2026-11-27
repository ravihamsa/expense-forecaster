import { occurrencesInMonth, toDateInputValue } from './schedule'
import type { AppData, LedgerEntry, MoneyAccount } from './types'

export const CASH_ACCOUNT = 'cash'
export const BANK_ACCOUNT = 'bank'
export const OPENING_ACCOUNT = 'opening:equity'

export interface AccountTotal {
  account: string
  label: string
  amount: number
}

export interface LedgerRow extends LedgerEntry {
  /** Effect on cash + bank for this entry. */
  cashImpact: number
  /** Running cash + bank balance after this entry. */
  runningBalance: number
}

export interface LedgerSummary {
  rows: LedgerRow[]
  openingBalance: number
  totalIn: number
  totalOut: number
  net: number
  cashBalance: number
  bankBalance: number
  liquidBalance: number
  bySource: AccountTotal[]
  byDestination: AccountTotal[]
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function previousDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() - 1)
  return dateKey(date)
}

function isLiquid(account: string): account is MoneyAccount {
  return account === CASH_ACCOUNT || account === BANK_ACCOUNT
}

export function moneyAccount(value: MoneyAccount | undefined): MoneyAccount {
  return value === 'cash' ? 'cash' : 'bank'
}

export function incomeAccount(category: string): string {
  return `income:${category || 'Other'}`
}

export function expenseAccount(category: string): string {
  return `expense:${category || 'Other'}`
}

export function loanAccount(id: string): string {
  return `loan:${id}`
}

export function receivableAccount(id: string): string {
  return `receivable:${id}`
}

export function accountLabel(account: string, data: AppData): string {
  if (account === CASH_ACCOUNT) return 'Cash in hand'
  if (account === BANK_ACCOUNT) return 'Bank balance'
  if (account === OPENING_ACCOUNT) return 'Opening balance'
  const [prefix, ...rest] = account.split(':')
  const value = rest.join(':')
  if (prefix === 'loan') return data.loans.find((loan) => loan.id === value)?.name ?? 'Loan'
  if (prefix === 'receivable') {
    const name = data.loans.find((loan) => loan.id === value)?.name ?? 'Receivable'
    return `${name} (owed to you)`
  }
  return value || prefix
}

/**
 * Builds a strict double-entry trail from everything that has actually happened.
 * Every row has exactly one source and one destination for the same amount, so
 * an unbalanced entry cannot exist. Future-dated plans stay in the forecast.
 */
export function buildLedger(data: AppData, from = new Date()): LedgerEntry[] {
  const today = toDateInputValue(from)
  const entries: LedgerEntry[] = []
  const moves = new Map((data.cashFlowMoves ?? []).map((move) => [`${move.cash_flow_id}|${move.from_date}`, move]))
  const skips = new Set((data.cashFlowSkips ?? []).map((skip) => `${skip.cash_flow_id}|${skip.date}`))
  const overrides = new Map(
    (data.cashFlowOverrides ?? []).map((override) => [`${override.cash_flow_id}|${override.month}`, override.amount]),
  )
  const currentIndex = from.getFullYear() * 12 + from.getMonth()
  const latestMovedSource = (data.cashFlowMoves ?? []).reduce((latest, move) => {
    const [year, month] = move.from_date.split('-').map(Number)
    return Number.isInteger(year) && Number.isInteger(month)
      ? Math.max(latest, year * 12 + (month - 1))
      : latest
  }, currentIndex)

  for (const flow of data.cashFlows ?? []) {
    if (!flow.start_date) continue
    const [startYear, startMonth] = flow.start_date.split('-').map(Number)
    if (!startYear || !startMonth) continue
    const startIndex = startYear * 12 + (startMonth - 1)
    const lastIndex = Math.max(currentIndex, latestMovedSource)
    const money = moneyAccount(flow.account)
    const counterpart = flow.kind === 'income'
      ? incomeAccount(flow.category)
      : expenseAccount(flow.category)

    for (let index = startIndex; index <= lastIndex && index < startIndex + 240; index += 1) {
      const year = Math.floor(index / 12)
      const month = index % 12
      for (const occurrence of occurrencesInMonth(flow, year, month)) {
        const originalDate = dateKey(occurrence)
        if (flow.end_date && originalDate > flow.end_date) continue
        if (skips.has(`${flow.id}|${originalDate}`)) continue
        const move = moves.get(`${flow.id}|${originalDate}`)
        const date = move?.to_date || originalDate
        if (date > today) continue
        const monthKey = originalDate.slice(0, 7)
        const fixed = overrides.get(`${flow.id}|${monthKey}`)
        const amount = Math.max(0, fixed !== undefined ? Number(fixed) || 0 : Number(flow.amount) || 0)
        if (amount <= 0) continue
        entries.push({
          id: `${flow.id}-${originalDate}`,
          date,
          description: flow.name,
          from: flow.kind === 'income' ? counterpart : money,
          to: flow.kind === 'income' ? money : counterpart,
          amount,
          kind: flow.kind === 'income' ? 'income' : 'expense',
          cashFlowId: flow.id,
        })
      }
    }
  }

  const loansById = new Map((data.loans ?? []).map((loan) => [loan.id, loan]))

  for (const loan of data.loans ?? []) {
    if (!loan.start_date || loan.start_date > today) continue
    const amount = Math.max(0, Number(loan.principal) || 0)
    if (amount <= 0) continue
    const money = moneyAccount(loan.account)
    const borrowed = loan.direction !== 'lent'
    entries.push({
      id: `loan-principal-${loan.id}`,
      date: loan.start_date,
      description: borrowed ? `${loan.name} borrowed` : `${loan.name} lent`,
      from: borrowed ? loanAccount(loan.id) : money,
      to: borrowed ? money : receivableAccount(loan.id),
      amount,
      kind: borrowed ? 'borrowing' : 'lent',
      loanId: loan.id,
    })
  }

  for (const payment of data.loanPayments ?? []) {
    if (!payment.payment_date || payment.payment_date > today) continue
    const loan = loansById.get(payment.loan_id)
    if (!loan) continue
    const amount = Math.max(0, Number(payment.amount) || 0)
    if (amount <= 0) continue
    const money = moneyAccount(payment.account ?? loan.account)
    const borrowed = loan.direction !== 'lent'
    entries.push({
      id: `loan-payment-${payment.id}`,
      date: payment.payment_date,
      description: payment.note ? `${loan.name} · ${payment.note}` : loan.name,
      from: borrowed ? money : receivableAccount(loan.id),
      to: borrowed ? loanAccount(loan.id) : money,
      amount,
      kind: borrowed ? 'repayment' : 'received',
      loanId: loan.id,
    })
  }

  entries.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))

  const openingDate = previousDate(entries[0]?.date ?? today)
  const cash = Math.max(0, Number(data.profile.cash_in_hand) || 0)
  const bank = Math.max(0, Number(data.profile.bank_balance) || 0)
  if (cash > 0) {
    entries.unshift({
      id: 'opening-cash',
      date: openingDate,
      description: 'Opening cash in hand',
      from: OPENING_ACCOUNT,
      to: CASH_ACCOUNT,
      amount: cash,
      kind: 'opening',
    })
  }
  if (bank > 0) {
    entries.unshift({
      id: 'opening-bank',
      date: openingDate,
      description: 'Opening bank balance',
      from: OPENING_ACCOUNT,
      to: BANK_ACCOUNT,
      amount: bank,
      kind: 'opening',
    })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}

function accountTotals(map: Map<string, number>, data: AppData): AccountTotal[] {
  return [...map.entries()]
    .map(([account, amount]) => ({ account, amount }))
    .sort((a, b) => b.amount - a.amount)
    .map((item) => ({ ...item, label: accountLabel(item.account, data) }))
}

export function summarizeLedger(entries: LedgerEntry[], data: AppData): LedgerSummary {
  let cash = 0
  let bank = 0
  let openingBalance = 0
  let totalIn = 0
  let totalOut = 0
  const sources = new Map<string, number>()
  const destinations = new Map<string, number>()

  const rows = entries.map((entry) => {
    let cashImpact = 0
    if (entry.to === CASH_ACCOUNT) {
      cash += entry.amount
      cashImpact += entry.amount
    }
    if (entry.from === CASH_ACCOUNT) {
      cash -= entry.amount
      cashImpact -= entry.amount
    }
    if (entry.to === BANK_ACCOUNT) {
      bank += entry.amount
      cashImpact += entry.amount
    }
    if (entry.from === BANK_ACCOUNT) {
      bank -= entry.amount
      cashImpact -= entry.amount
    }

    if (entry.kind === 'opening') openingBalance += cashImpact
    else if (cashImpact >= 0) totalIn += cashImpact
    else totalOut += -cashImpact

    if (isLiquid(entry.to) && !isLiquid(entry.from)) {
      sources.set(entry.from, (sources.get(entry.from) ?? 0) + entry.amount)
    }
    if (isLiquid(entry.from) && !isLiquid(entry.to)) {
      destinations.set(entry.to, (destinations.get(entry.to) ?? 0) + entry.amount)
    }

    return { ...entry, cashImpact, runningBalance: cash + bank }
  })

  return {
    rows,
    openingBalance,
    totalIn,
    totalOut,
    net: totalIn - totalOut,
    cashBalance: cash,
    bankBalance: bank,
    liquidBalance: cash + bank,
    bySource: accountTotals(sources, data),
    byDestination: accountTotals(destinations, data),
  }
}
