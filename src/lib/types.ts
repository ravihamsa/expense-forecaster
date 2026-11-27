export type Tab =
  | 'dashboard'
  | 'cashflows'
  | 'budgets'
  | 'goals'
  | 'actuals'
  | 'loans'
  | 'accounts'
  | 'balance'
  | 'calendar'
  | 'ledger'
  | 'settings'

export type Recurrence =
  | 'one_time'
  | 'monthly'
  | 'yearly'
  | 'every_n_months'
  | 'every_n_years'

export type FlowKind = 'income' | 'expense'
/** Account id. 'cash' and 'bank' are built in; custom ids are UUIDs. */
export type MoneyAccount = string

export interface Account {
  id: string
  user_id: string
  name: string
  kind: 'cash' | 'bank' | 'other'
  opening_balance: number
  created_at?: string
}

/** A net-neutral movement between two of your own accounts. */
export interface Transfer {
  id: string
  user_id: string
  from_account: string
  to_account: string
  amount: number
  date: string
  note: string
  created_at?: string
}

export type LoanRepayment = 'emi' | 'one_time'
export type LoanDirection = 'borrowed' | 'lent'

export interface Profile {
  user_id: string
  display_name: string
  currency: string
  /** Legacy fallback used only until the first planned monthly income is saved. */
  monthly_income: number
  /** Cash you physically hold; combined with bank_balance to start the plan. */
  cash_in_hand: number
  bank_balance: number
  /** Derived total of every account's opening balance, used by the forecast. */
  opening_balance: number
  horizon_months: number
  income_growth_pct: number
  expense_inflation_pct: number
  created_at?: string
  updated_at?: string
}

export interface CashFlow {
  id: string
  user_id: string
  kind: FlowKind
  name: string
  amount: number
  category: string
  /** Account this flow hits. Older rows default to bank. */
  account?: MoneyAccount
  recurrence: Recurrence
  interval_count: number
  start_date: string
  end_date: string | null
  /** Set to 'sms' for one-time rows imported from the Android companion. */
  source?: string
  note: string
  created_at?: string
}

/** Expected take-home for a specific calendar month (YYYY-MM). */
export interface MonthlyIncome {
  id: string
  user_id: string
  month: string
  amount: number
  /** Day of the month this income is expected to arrive. Defaults to 1. */
  day?: number
  note: string
  created_at?: string
}

/** A fixed amount for one occurrence of a cash flow (YYYY-MM). */
export interface CashFlowOverride {
  id: string
  user_id: string
  cash_flow_id: string
  month: string
  amount: number
  created_at?: string
}

/** Moves one scheduled occurrence to a different calendar date. */
export interface CashFlowMove {
  id: string
  user_id: string
  cash_flow_id: string
  /** Original occurrence date (YYYY-MM-DD). */
  from_date: string
  /** New occurrence date (YYYY-MM-DD). */
  to_date: string
  created_at?: string
}

/** Removes one scheduled occurrence from forecasts and the money trail. */
export interface CashFlowSkip {
  id: string
  user_id: string
  cash_flow_id: string
  /** Original occurrence date (YYYY-MM-DD), before any calendar move. */
  date: string
  created_at?: string
}

export interface Budget {
  id: string
  user_id: string
  category: string
  monthly_limit: number
  /** Unused budget carries into the next month (overspend carries too). */
  rollover: boolean
  created_at?: string
}

export interface Goal {
  id: string
  user_id: string
  name: string
  target_amount: number
  current_amount: number
  target_date: string | null
  monthly_contribution: number
  note: string
  created_at?: string
}

/** A learned SMS companion classification for a vendor/sender pair. */
export interface VendorRule {
  id: string
  user_id: string
  vendor_key: string
  vendor_name: string
  kind: FlowKind
  category: string
  account: MoneyAccount
  auto_apply: boolean
  created_at?: string
  updated_at?: string
}

/** A recorded amount for one planned cash-flow occurrence. */
export interface Actual {
  id: string
  user_id: string
  /** Stable key from the forecast: cash-flow occurrence or income month. */
  event_key: string
  cash_flow_id?: string | null
  date: string
  name: string
  category: string
  kind: FlowKind
  amount: number
  /** Account the recorded amount was actually paid from / received into. */
  account?: MoneyAccount
  /** Set to 'sms' for actuals imported from the Android companion. */
  source?: string
  note: string
  created_at?: string
}

/**
 * One strict double-entry movement: `from` decreases, `to` increases, and both
 * sides always carry the same amount. Derived automatically from recorded data.
 */
export interface LedgerEntry {
  id: string
  date: string
  description: string
  from: string
  to: string
  amount: number
  kind: 'opening' | 'income' | 'expense' | 'borrowing' | 'repayment' | 'lent' | 'received' | 'transfer'
  cashFlowId?: string
  loanId?: string
}

export interface Loan {
  id: string
  user_id: string
  name: string
  /** Liquid account used for the principal and its payments. Older rows default to bank. */
  account?: MoneyAccount
  /** borrowed = you owe them; lent = they owe you. */
  direction: LoanDirection
  repayment_type: LoanRepayment
  principal: number
  outstanding: number
  interest_rate: number
  emi: number
  start_date: string
  tenure_months: number
  due_day: number
  /** Planned lump-sum repayment date for one-time / hand loans. */
  due_date: string | null
  created_at?: string
}

export interface LoanPayment {
  id: string
  user_id: string
  loan_id: string
  amount: number
  payment_date: string
  /** Liquid account the payment was made from / received into. Defaults to bank. */
  account?: MoneyAccount
  note: string
  /** True when the payment already reduced the loan's outstanding balance. */
  applied_to_balance: boolean
  created_at?: string
}

export interface AppData {
  profile: Profile
  accounts: Account[]
  transfers: Transfer[]
  monthlyIncomes: MonthlyIncome[]
  cashFlows: CashFlow[]
  cashFlowOverrides: CashFlowOverride[]
  cashFlowMoves: CashFlowMove[]
  cashFlowSkips: CashFlowSkip[]
  budgets: Budget[]
  goals: Goal[]
  vendorRules: VendorRule[]
  actuals: Actual[]
  loans: Loan[]
  loanPayments: LoanPayment[]
}

/** Portable JSON envelope used to move data between browsers and accounts. */
export interface DataExport {
  app: 'finplannar'
  version: 1 | 2
  exportedAt: string
  source: {
    mode: 'local' | 'supabase'
    userId: string
  }
  account: {
    display_name: string
    email: string
  }
  data: AppData
}

export interface FlowEvent {
  id: string
  name: string
  kind: FlowKind
  amount: number
  category: string
  /** Account affected by this occurrence. */
  account?: MoneyAccount
  source: 'profile' | 'cash_flow' | 'loan' | 'extra_payment'
  /** Cash flow behind this event, so it can be edited in the month preview. */
  cashFlowId?: string
  /** Monthly income row behind this event, when one was planned explicitly. */
  monthlyIncomeId?: string
  /** Exact calendar date (YYYY-MM-DD) the cash flow lands on. */
  date: string
  /** Month this occurrence originally belongs to (YYYY-MM); amount overrides use it. */
  sourceMonth?: string
  /** Original date before a calendar move was applied. */
  originalDate?: string
  /** Stored move, when this occurrence was rescheduled from the calendar. */
  moveId?: string
  /** True when this event can be moved, duplicated or split in the calendar. */
  canMove?: boolean
  /** True when the event date differs from its schedule. */
  moved?: boolean
  /** True when this occurrence uses a fixed amount set for that month. */
  overridden?: boolean
  /** Recorded amount for this occurrence, when it has been marked as actual. */
  actualAmount?: number
  actualId?: string
  /** Used by the calendar to show a skipped occurrence that can be restored. */
  skipId?: string
  skipped?: boolean
}

export interface MonthProjection {
  key: string
  label: string
  monthLabel: string
  year: number
  monthIndex: number
  income: number
  expenses: number
  loanPayments: number
  loanInflows: number
  net: number
  openingBalance: number
  closingBalance: number
  /** Projected balance of every account at month end. */
  accountBalances: Record<string, number>
  cumulativeNet: number
  events: FlowEvent[]
  activeLoans: number
  loanBalances: Record<string, number>
  paidOffLoans: string[]
  extraPayment: number
}

export interface Simulation {
  months: MonthProjection[]
  totalIncome: number
  totalExpenses: number
  totalLoanPayments: number
  totalLoanInflows: number
  totalInterest: number
  deficitMonths: number
  surplusMonths: number
  totalDeficit: number
  endingBalance: number
  lowestBalance: number
  /** Final projected balance per account. */
  accountBalances: Record<string, number>
  payoff: { loanId: string; name: string; monthIndex: number; label: string }[]
}

export interface SimulationOptions {
  expenseCutPct: number
  extraLoanPayment: number
  extraPaymentLoanId: string | 'highest_rate'
}

export type NewAccount = Omit<Account, 'id' | 'user_id' | 'created_at'>
export type NewTransfer = Omit<Transfer, 'id' | 'user_id' | 'created_at'>
export type NewCashFlow = Omit<CashFlow, 'id' | 'user_id' | 'created_at'>
export type NewLoan = Omit<Loan, 'id' | 'user_id' | 'created_at'>
export type NewLoanPayment = Omit<LoanPayment, 'id' | 'user_id' | 'created_at' | 'applied_to_balance'>
export type NewMonthlyIncome = Omit<MonthlyIncome, 'id' | 'user_id' | 'created_at'>
export type NewCashFlowOverride = Omit<CashFlowOverride, 'id' | 'user_id' | 'created_at'>
export type NewCashFlowMove = Omit<CashFlowMove, 'id' | 'user_id' | 'created_at'>
export type NewCashFlowSkip = Omit<CashFlowSkip, 'id' | 'user_id' | 'created_at'>
export type NewBudget = Omit<Budget, 'id' | 'user_id' | 'created_at'>
export type NewGoal = Omit<Goal, 'id' | 'user_id' | 'created_at'>
export type NewActual = Omit<Actual, 'id' | 'user_id' | 'created_at'>

export interface AppActions {
  saveProfile(patch: Partial<Profile>): Promise<void>
  addAccount(input: NewAccount): Promise<void>
  updateAccount(id: string, patch: Partial<NewAccount>): Promise<void>
  deleteAccount(id: string): Promise<void>
  addTransfer(input: NewTransfer): Promise<void>
  deleteTransfer(id: string): Promise<void>
  upsertMonthlyIncome(input: NewMonthlyIncome): Promise<void>
  deleteMonthlyIncome(id: string): Promise<void>
  addCashFlow(input: NewCashFlow): Promise<void>
  updateCashFlow(id: string, patch: Partial<NewCashFlow>): Promise<void>
  deleteCashFlow(id: string): Promise<void>
  upsertCashFlowOverride(input: NewCashFlowOverride): Promise<void>
  deleteCashFlowOverride(id: string): Promise<void>
  upsertCashFlowMove(input: NewCashFlowMove): Promise<void>
  deleteCashFlowMove(id: string): Promise<void>
  upsertCashFlowSkip(input: NewCashFlowSkip): Promise<void>
  deleteCashFlowSkip(id: string): Promise<void>
  upsertBudget(input: NewBudget): Promise<void>
  deleteBudget(id: string): Promise<void>
  upsertGoal(input: NewGoal): Promise<void>
  updateGoal(id: string, patch: Partial<NewGoal>): Promise<void>
  deleteGoal(id: string): Promise<void>
  upsertActual(input: NewActual): Promise<void>
  deleteActual(id: string): Promise<void>
  /** Remove all SMS-tagged cash flows, actuals, and their dependent edits. */
  deleteSmsImports(): Promise<void>
  addLoan(input: NewLoan): Promise<void>
  updateLoan(id: string, patch: Partial<NewLoan>): Promise<void>
  deleteLoan(id: string): Promise<void>
  addLoanPayment(input: NewLoanPayment): Promise<void>
  deleteLoanPayment(id: string): Promise<void>
  /** Import a JSON export, remapping ids and user_id to the signed-in account. */
  importData(payload: DataExport, replace: boolean): Promise<void>
}

export interface Advice {
  id: string
  title: string
  detail: string
  impact: string
  tone: 'good' | 'warn' | 'info'
  action?: {
    label: string
    tab: 'cashflows' | 'budgets' | 'goals' | 'actuals' | 'loans' | 'settings' | 'balance' | 'calendar'
  }
}
