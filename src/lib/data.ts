import { budgetKey } from './budgets'
import { defaultCategories, defaultCategoryId } from './categories'
import { goalFundAccountId } from './goals'
import { planBudgetOnlyMigration, type BudgetOnlyMigration } from './migrate'
import { toDateInputValue } from './schedule'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import type {
  Account,
  Actual,
  AppCategory,
  AppData,
  Budget,
  CashFlow,
  CashFlowMove,
  CashFlowOverride,
  CashFlowSkip,
  DataExport,
  Goal,
  Loan,
  LoanPayment,
  MonthlyIncome,
  Profile,
  Transfer,
  VendorRule,
} from './types'

export type AccountInput = Omit<Account, 'id' | 'user_id' | 'created_at'>
export type TransferInput = Omit<Transfer, 'id' | 'user_id' | 'created_at'>
export type CategoryInput = Omit<AppCategory, 'id' | 'user_id' | 'created_at'>
export type CashFlowInput = Omit<CashFlow, 'id' | 'user_id' | 'created_at'>
export type CashFlowOverrideInput = Omit<CashFlowOverride, 'id' | 'user_id' | 'created_at'>
export type CashFlowMoveInput = Omit<CashFlowMove, 'id' | 'user_id' | 'created_at'>
export type CashFlowSkipInput = Omit<CashFlowSkip, 'id' | 'user_id' | 'created_at'>
export type BudgetInput = Omit<Budget, 'id' | 'user_id' | 'created_at'>
export type GoalInput = Omit<Goal, 'id' | 'user_id' | 'created_at'>
export type ActualInput = Omit<Actual, 'id' | 'user_id' | 'created_at'>
export type MonthlyIncomeInput = Omit<MonthlyIncome, 'id' | 'user_id' | 'created_at'>
export type LoanInput = Omit<Loan, 'id' | 'user_id' | 'created_at'>
export type LoanPaymentInput = Omit<LoanPayment, 'id' | 'user_id' | 'created_at' | 'applied_to_balance'>
export type ProfilePatch = Partial<Omit<Profile, 'user_id' | 'created_at' | 'updated_at'>>

export interface AuthUser {
  id: string
  email: string
  name: string
}

export const usingSupabase = isSupabaseConfigured && supabase !== null

/** Tables added in the multi-account migration may not exist yet on older projects. */
function isMissingTable(code: string | undefined): boolean {
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST116'
}

export function isSmsImport(row: { source?: string }): boolean {
  return row.source === 'sms'
}

// ---------------------------------------------------------------------------
// Local demo mode (used only when Supabase env vars are not configured)
// ---------------------------------------------------------------------------

interface LocalUser extends AuthUser {
  salt: string
  passwordHash: string
}

const KEYS = {
  users: 'fp_local_users',
  session: 'fp_local_session',
  data: (userId: string) => `fp_local_data_${userId}`,
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${password}`)
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  let hash = 2166136261
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function defaultProfile(userId: string, displayName: string): Profile {
  return {
    user_id: userId,
    display_name: displayName,
    currency: 'INR',
    monthly_income: 0,
    cash_in_hand: 0,
    bank_balance: 0,
    opening_balance: 0,
    horizon_months: 12,
    income_growth_pct: 0,
    expense_inflation_pct: 0,
  }
}

function defaultAccounts(userId: string, profile: Profile): Account[] {
  return [
    { id: 'cash', user_id: userId, name: 'Cash in hand', kind: 'cash', opening_balance: profile.cash_in_hand || 0 },
    { id: 'bank', user_id: userId, name: 'Bank balance', kind: 'bank', opening_balance: profile.bank_balance || 0 },
  ]
}

function defaultData(userId: string, displayName: string): AppData {
  const profile = defaultProfile(userId, displayName)
  return {
    profile,
    categories: defaultCategories(userId),
    accounts: defaultAccounts(userId, profile),
    transfers: [],
    monthlyIncomes: [],
    cashFlows: [],
    cashFlowOverrides: [],
    cashFlowMoves: [],
    cashFlowSkips: [],
    budgets: [],
    goals: [],
    vendorRules: [],
    actuals: [],
    loans: [],
    loanPayments: [],
  }
}

function localUsers(): LocalUser[] {
  return readJSON<LocalUser[]>(KEYS.users, [])
}

function localCurrentUser(): AuthUser | null {
  const id = localStorage.getItem(KEYS.session)
  if (!id) return null
  const user = localUsers().find((candidate) => candidate.id === id)
  return user ? { id: user.id, email: user.email, name: user.name } : null
}

function emitAuthChange(): void {
  window.dispatchEvent(new Event('fp-auth-change'))
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function signUp(email: string, password: string, name: string): Promise<{ needsConfirmation: boolean }> {
  if (usingSupabase && supabase) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    })
    if (error) throw error
    return { needsConfirmation: !data.session }
  }

  const users = localUsers()
  if (users.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('An account with this email already exists.')
  }
  const salt = makeId()
  const user: LocalUser = {
    id: makeId(),
    email,
    name: name || email.split('@')[0],
    salt,
    passwordHash: await hashPassword(password, salt),
  }
  users.push(user)
  writeJSON(KEYS.users, users)
  localStorage.setItem(KEYS.session, user.id)
  emitAuthChange()
  return { needsConfirmation: false }
}

export async function signIn(email: string, password: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return
  }

  const user = localUsers().find((candidate) => candidate.email.toLowerCase() === email.toLowerCase())
  if (!user || (await hashPassword(password, user.salt)) !== user.passwordHash) {
    throw new Error('Invalid email or password.')
  }
  localStorage.setItem(KEYS.session, user.id)
  emitAuthChange()
}

export async function signOut(): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    return
  }
  localStorage.removeItem(KEYS.session)
  emitAuthChange()
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (usingSupabase && supabase) {
    const { data } = await supabase.auth.getUser()
    if (!data.user) return null
    return {
      id: data.user.id,
      email: data.user.email ?? '',
      name: (data.user.user_metadata?.full_name as string) || data.user.email?.split('@')[0] || 'There',
    }
  }
  return localCurrentUser()
}

export function onAuthChange(callback: (user: AuthUser | null) => void): () => void {
  if (usingSupabase && supabase) {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user
      callback(
        user
          ? {
              id: user.id,
              email: user.email ?? '',
              name: (user.user_metadata?.full_name as string) || user.email?.split('@')[0] || 'There',
            }
          : null,
      )
    })
    return () => data.subscription.unsubscribe()
  }

  const handler = () => callback(localCurrentUser())
  window.addEventListener('storage', handler)
  window.addEventListener('fp-auth-change', handler)
  return () => {
    window.removeEventListener('storage', handler)
    window.removeEventListener('fp-auth-change', handler)
  }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function ensureNumbers(row: Record<string, unknown>): Record<string, unknown> {
  const numericFields = [
    'monthly_income',
    'cash_in_hand',
    'bank_balance',
    'opening_balance',
    'income_growth_pct',
    'expense_inflation_pct',
    'amount',
    'monthly_limit',
    'principal',
    'outstanding',
    'interest_rate',
    'emi',
    'tenure_months',
    'due_day',
    'interval_count',
    'horizon_months',
  ]
  const output = { ...row }
  numericFields.forEach((field) => {
    if (field in output && output[field] !== null) output[field] = Number(output[field])
  })
  return output
}

function normalizeProfile(profile: Profile): Profile {
  const raw = profile as Partial<Profile>
  const hasCash = raw.cash_in_hand !== undefined
  const hasBank = raw.bank_balance !== undefined
  // Profiles saved before this split had only opening_balance; treat that as bank money.
  const cash = hasCash ? Number(raw.cash_in_hand) || 0 : 0
  const bank = hasBank ? Number(raw.bank_balance) || 0 : Number(raw.opening_balance) || 0
  return {
    ...profile,
    cash_in_hand: cash,
    bank_balance: bank,
    opening_balance: hasCash && hasBank ? cash + bank : Number(raw.opening_balance) || 0,
  }
}

function normalizeData(data: AppData): AppData {
  const raw = data as Partial<AppData>
  const legacyProfile = normalizeProfile(raw.profile ?? defaultProfile('', ''))
  const userId = legacyProfile.user_id

  // Categories are a reusable list. Old data has no list yet, so it gets the
  // built-ins plus any category already used by a row (including SMS imports).
  const categories: AppCategory[] = []
  const categoryKeys = new Set<string>()
  const addCategory = (row: { id?: string; user_id?: string; name?: string; kind?: string }) => {
    const name = (row.name ?? '').trim()
    const kind = row.kind === 'income' ? 'income' : 'expense'
    if (!name) return
    const key = `${kind}:${name.toLowerCase()}`
    if (categoryKeys.has(key)) return
    categoryKeys.add(key)
    categories.push({
      id: row.id || defaultCategoryId(kind, name),
      user_id: row.user_id || userId,
      name,
      kind,
    })
  }
  ;(raw.categories?.length ? raw.categories : defaultCategories(userId)).forEach(addCategory)
  const categoryRefs: { name: string; kind: AppCategory['kind'] }[] = [
    ...(raw.cashFlows ?? []).map((row) => ({ name: row.category ?? '', kind: row.kind })),
    ...(raw.budgets ?? []).map((row) => ({ name: row.category ?? '', kind: 'expense' as const })),
    ...(raw.vendorRules ?? []).map((row) => ({ name: row.category ?? '', kind: row.kind })),
    ...(raw.actuals ?? []).map((row) => ({ name: row.category ?? '', kind: row.kind })),
  ]
  categoryRefs.forEach(addCategory)
  for (const kind of ['expense', 'income'] as const) {
    addCategory({ id: defaultCategoryId(kind, 'Other'), name: 'Other', kind })
  }

  const accounts: Account[] = (raw.accounts ?? []).map((account) => ({
    ...account,
    user_id: account.user_id || userId,
    name: account.name || account.id,
    kind: account.kind === 'cash' || account.kind === 'bank' ? account.kind : 'other',
    opening_balance: Math.max(0, Number(account.opening_balance) || 0),
  }))
  for (const builtIn of defaultAccounts(userId, legacyProfile)) {
    if (!accounts.some((account) => account.id === builtIn.id)) accounts.push(builtIn)
  }
  // Referenced custom accounts from an older export still get a placeholder row.
  const references = [
    ...(raw.cashFlows ?? []).map((row) => row.account),
    ...(raw.loans ?? []).map((row) => row.account),
    ...(raw.loanPayments ?? []).map((row) => row.account),
    ...(raw.actuals ?? []).map((row) => row.account),
    ...(raw.vendorRules ?? []).map((row) => row.account),
    ...(raw.transfers ?? []).flatMap((row) => [row.from_account, row.to_account]),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
  references.forEach((id) => {
    if (!accounts.some((account) => account.id === id)) {
      accounts.push({ id, user_id: userId, name: id, kind: 'other', opening_balance: 0 })
    }
  })
  const accountIds = new Set(accounts.map((account) => account.id))
  const accountId = (value: string | undefined, fallback = 'bank'): string => {
    const candidate = value || fallback
    return accountIds.has(candidate) ? candidate : 'bank'
  }
  const cash = accounts.find((account) => account.id === 'cash')?.opening_balance ?? legacyProfile.cash_in_hand
  const bank = accounts.find((account) => account.id === 'bank')?.opening_balance ?? legacyProfile.bank_balance

  return {
    ...data,
    profile: {
      ...legacyProfile,
      cash_in_hand: cash,
      bank_balance: bank,
      opening_balance: accounts.reduce((sum, account) => sum + account.opening_balance, 0),
    },
    categories,
    accounts,
    transfers: (raw.transfers ?? []).map((transfer) => ({
      ...transfer,
      user_id: transfer.user_id || userId,
      from_account: accountId(transfer.from_account),
      to_account: accountId(transfer.to_account),
      amount: Math.max(0, Number(transfer.amount) || 0),
      date: transfer.date || '',
      note: transfer.note ?? '',
    })),
    monthlyIncomes: (raw.monthlyIncomes ?? []).map((entry) => ({
      ...entry,
      amount: Number(entry.amount) || 0,
      day: Math.max(1, Math.min(31, Math.round(Number(entry.day) || 1))),
      note: entry.note ?? '',
    })),
    cashFlowOverrides: (raw.cashFlowOverrides ?? []).map((override) => ({
      ...override,
      amount: Number(override.amount) || 0,
    })),
    cashFlowMoves: raw.cashFlowMoves ?? [],
    cashFlowSkips: raw.cashFlowSkips ?? [],
    budgets: (raw.budgets ?? []).map((budget) => ({
      ...budget,
      monthly_limit: Number(budget.monthly_limit) || 0,
      rollover: budget.rollover ?? false,
      period: budget.period === 'yearly' || budget.period === 'one_time' ? budget.period : 'monthly',
      start_date: budget.start_date || '1970-01-01',
      name: budget.name ?? '',
      cash_flow_id: budget.cash_flow_id ?? null,
    })),
    goals: (raw.goals ?? []).map((goal) => ({
      ...goal,
      target_amount: Number(goal.target_amount) || 0,
      current_amount: Number(goal.current_amount) || 0,
      monthly_contribution: Number(goal.monthly_contribution) || 0,
      target_date: goal.target_date ?? null,
      note: goal.note ?? '',
    })),
    vendorRules: (raw.vendorRules ?? []).map((rule) => ({
      ...rule,
      vendor_name: rule.vendor_name ?? '',
      category: rule.category || 'Other',
      account: accountId(rule.account),
      auto_apply: rule.auto_apply ?? false,
    })),
    actuals: (raw.actuals ?? []).map((actual) => ({
      ...actual,
      amount: Number(actual.amount) || 0,
      cash_flow_id: actual.cash_flow_id ?? null,
      account: accountId(actual.account),
      note: actual.note ?? '',
    })),
    cashFlows: (raw.cashFlows ?? []).map((flow) => ({
      ...flow,
      account: accountId(flow.account),
    })),
    loanPayments: (raw.loanPayments ?? []).map((payment) => ({
      ...payment,
      account: accountId(payment.account ?? raw.loans?.find((loan) => loan.id === payment.loan_id)?.account),
      applied_to_balance: payment.applied_to_balance ?? false,
    })),
    loans: (raw.loans ?? []).map((loan) => ({
      ...loan,
      account: accountId(loan.account),
      direction: loan.direction ?? 'borrowed',
      repayment_type: loan.repayment_type ?? 'emi',
      due_date: loan.due_date ?? null,
    })),
  }
}

async function persistBudgetOnlyMigration(user: AuthUser, migration: BudgetOnlyMigration): Promise<void> {
  if (!usingSupabase || !supabase) return
  for (const budget of migration.addedBudgets) {
    const { id: _id, created_at: _created, cash_flow_id: _link, ...row } = budget
    void _id
    void _created
    void _link
    const { error } = await supabase.from('budgets').insert(row)
    if (error) throw error
  }
  for (const id of migration.clearedBudgetLinks) {
    const { error } = await supabase
      .from('budgets')
      .update({ cash_flow_id: null })
      .eq('id', id)
      .eq('user_id', user.id)
    if (error && !error.message.toLowerCase().includes('cash_flow_id')) throw error
  }
  for (const actual of migration.updatedActuals) {
    const { error } = await supabase
      .from('actuals')
      .update({ event_key: actual.event_key })
      .eq('id', actual.id)
      .eq('user_id', user.id)
    if (error) throw error
    // Older schemas may not have the deprecated link column yet. The stable
    // event key is what matters, so a missing column is safe to ignore.
    const { error: linkError } = await supabase
      .from('actuals')
      .update({ cash_flow_id: null })
      .eq('id', actual.id)
      .eq('user_id', user.id)
    if (linkError && !linkError.message.toLowerCase().includes('cash_flow_id')) throw linkError
  }
  for (const table of ['cash_flow_overrides', 'cash_flow_moves', 'cash_flow_skips'] as const) {
    for (const id of migration.deletedCashFlowIds) {
      const { error } = await supabase.from(table).delete().eq('user_id', user.id).eq('cash_flow_id', id)
      if (error && !isMissingTable(error.code)) throw error
    }
  }
  for (const id of migration.deletedCashFlowIds) {
    const { error } = await supabase.from('cash_flows').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
  }
}

export async function loadData(user: AuthUser): Promise<AppData> {
  if (usingSupabase && supabase) {
    const [
      profileResult,
      categoriesResult,
      accountsResult,
      transfersResult,
      incomesResult,
      flowsResult,
      overridesResult,
      movesResult,
      skipsResult,
      budgetsResult,
      goalsResult,
      vendorRulesResult,
      actualsResult,
      loansResult,
      paymentsResult,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('categories').select('*').eq('user_id', user.id).order('name', { ascending: true }),
      supabase.from('accounts').select('*').eq('user_id', user.id).order('created_at', { ascending: true }),
      supabase.from('transfers').select('*').eq('user_id', user.id).order('date', { ascending: false }),
      supabase.from('monthly_incomes').select('*').eq('user_id', user.id).order('month', { ascending: true }),
      supabase.from('cash_flows').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
      supabase.from('cash_flow_overrides').select('*').eq('user_id', user.id).order('month', { ascending: true }),
      supabase.from('cash_flow_moves').select('*').eq('user_id', user.id).order('from_date', { ascending: true }),
      supabase.from('cash_flow_skips').select('*').eq('user_id', user.id).order('date', { ascending: true }),
      supabase.from('budgets').select('*').eq('user_id', user.id).order('category', { ascending: true }),
      supabase.from('goals').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('vendor_rules').select('*').eq('user_id', user.id).order('vendor_name', { ascending: true }),
      supabase.from('actuals').select('*').eq('user_id', user.id).order('date', { ascending: false }),
      supabase.from('loans').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('loan_payments').select('*').eq('user_id', user.id).order('payment_date', { ascending: false }),
    ])
    if (profileResult.error) throw profileResult.error
    if (categoriesResult.error && !isMissingTable(categoriesResult.error.code)) throw categoriesResult.error
    if (accountsResult.error && !isMissingTable(accountsResult.error.code)) throw accountsResult.error
    if (transfersResult.error && !isMissingTable(transfersResult.error.code)) throw transfersResult.error
    if (incomesResult.error) throw incomesResult.error
    if (flowsResult.error) throw flowsResult.error
    if (overridesResult.error) throw overridesResult.error
    if (movesResult.error) throw movesResult.error
    if (skipsResult.error) throw skipsResult.error
    if (budgetsResult.error) throw budgetsResult.error
    if (goalsResult.error) throw goalsResult.error
    if (vendorRulesResult.error) throw vendorRulesResult.error
    if (actualsResult.error) throw actualsResult.error
    if (loansResult.error) throw loansResult.error
    if (paymentsResult.error) throw paymentsResult.error

    const profile = profileResult.data
      ? (ensureNumbers(profileResult.data as unknown as Record<string, unknown>) as unknown as Profile)
      : defaultProfile(user.id, user.name)
    if (!profileResult.data) {
      const { created_at: _created, updated_at: _updated, ...newProfile } = profile
      void _created
      void _updated
      const { error } = await supabase.from('profiles').insert(newProfile)
      if (error) throw error
    }
    const normalized = normalizeData({
      profile,
      categories: (categoriesResult.error ? undefined : categoriesResult.data) as unknown as AppCategory[],
      accounts: accountsResult.error ? [] : (accountsResult.data ?? []) as unknown as Account[],
      transfers: transfersResult.error ? [] : (transfersResult.data ?? []).map(
        (row) => ensureNumbers(row as unknown as Record<string, unknown>) as unknown as Transfer,
      ),
      monthlyIncomes: (incomesResult.data ?? []).map(
        (row) => ensureNumbers(row as unknown as Record<string, unknown>) as unknown as MonthlyIncome,
      ),
      cashFlows: (flowsResult.data ?? []).map(
        (row) => ensureNumbers(row as unknown as Record<string, unknown>) as unknown as CashFlow,
      ),
      cashFlowOverrides: (overridesResult.data ?? []).map(
        (row) => ensureNumbers(row as unknown as Record<string, unknown>) as unknown as CashFlowOverride,
      ),
      cashFlowMoves: (movesResult.data ?? []) as unknown as CashFlowMove[],
      cashFlowSkips: (skipsResult.data ?? []) as unknown as CashFlowSkip[],
      budgets: (budgetsResult.data ?? []).map(
        (row) => ensureNumbers(row as unknown as Record<string, unknown>) as unknown as Budget,
      ),
      goals: (goalsResult.data ?? []).map(
        (row) => ensureNumbers(row as unknown as Record<string, unknown>) as unknown as Goal,
      ),
      vendorRules: (vendorRulesResult.data ?? []) as unknown as VendorRule[],
      actuals: (actualsResult.data ?? []).map(
        (row) => ensureNumbers(row as unknown as Record<string, unknown>) as unknown as Actual,
      ),
      loans: (loansResult.data ?? []).map(
        (row) => ensureNumbers(row as unknown as Record<string, unknown>) as unknown as Loan,
      ),
      loanPayments: (paymentsResult.data ?? []).map(
        (row) => ensureNumbers(row as unknown as Record<string, unknown>) as unknown as LoanPayment,
      ),
    })
    const migration = planBudgetOnlyMigration(normalized)
    if (migration.changed) await persistBudgetOnlyMigration(user, migration)
    return migration.data
  }

  const stored = readJSON<AppData | null>(KEYS.data(user.id), null)
  const normalized = normalizeData(stored?.profile
    ? stored
    : defaultData(user.id, user.name))
  const migration = planBudgetOnlyMigration(normalized)
  if (!stored?.profile || migration.changed) writeJSON(KEYS.data(user.id), migration.data)
  return migration.data
}

async function updateLocal(user: AuthUser, updater: (data: AppData) => AppData): Promise<void> {
  const data = await loadData(user)
  writeJSON(KEYS.data(user.id), updater(data))
}

export async function saveProfile(user: AuthUser, patch: ProfilePatch, syncAccounts = true): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase
      .from('profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
    if (error) throw error
    if (syncAccounts) {
      for (const [id, field] of [['cash', 'cash_in_hand'], ['bank', 'bank_balance']] as const) {
        if (patch[field] === undefined) continue
        // Keep any custom name/kind the user gave the built-in account.
        const existing = await supabase
          .from('accounts')
          .select('name, kind')
          .eq('user_id', user.id)
          .eq('id', id)
          .maybeSingle()
        if (existing.error && !isMissingTable(existing.error.code)) throw existing.error
        const { error: accountError } = await supabase.from('accounts').upsert({
          id,
          user_id: user.id,
          name: existing.data?.name || (id === 'cash' ? 'Cash in hand' : 'Bank balance'),
          kind: existing.data?.kind === 'cash' || existing.data?.kind === 'bank' ? existing.data.kind : id,
          opening_balance: Math.max(0, Number(patch[field]) || 0),
        }, { onConflict: 'user_id,id' })
        if (accountError && !isMissingTable(accountError.code)) throw accountError
      }
    }
    return
  }
  await updateLocal(user, (data) => {
    const accounts = !syncAccounts ? data.accounts : data.accounts.map((account) => {
      if (account.id === 'cash' && patch.cash_in_hand !== undefined) {
        return { ...account, opening_balance: Math.max(0, Number(patch.cash_in_hand) || 0) }
      }
      if (account.id === 'bank' && patch.bank_balance !== undefined) {
        return { ...account, opening_balance: Math.max(0, Number(patch.bank_balance) || 0) }
      }
      return account
    })
    const openingBalance = accounts.reduce((sum, account) => sum + account.opening_balance, 0)
    return {
      ...data,
      accounts,
      profile: { ...data.profile, ...patch, opening_balance: openingBalance, updated_at: new Date().toISOString() },
    }
  })
}

async function syncProfileFromAccounts(user: AuthUser, accounts: Account[]): Promise<void> {
  const cash = accounts.find((account) => account.id === 'cash')?.opening_balance ?? 0
  const bank = accounts.find((account) => account.id === 'bank')?.opening_balance ?? 0
  const opening_balance = accounts.reduce((sum, account) => sum + account.opening_balance, 0)
  await saveProfile(user, { cash_in_hand: cash, bank_balance: bank, opening_balance }, false)
}

async function persistCategories(user: AuthUser, updater: (data: AppData) => AppData): Promise<void> {
  const stored = await loadData(user)
  writeJSON(KEYS.data(user.id), normalizeData(updater(stored)))
}

function remapCategoryReferencesLocally(
  data: AppData,
  kind: AppCategory['kind'],
  from: string,
  to: string,
  dropBudget: boolean,
): AppData {
  const budgets = data.budgets
    .filter((budget) => !(dropBudget && budget.category === from))
    .map((budget) => (kind === 'expense' && budget.category === from ? { ...budget, category: to } : budget))
  return {
    ...data,
    cashFlows: data.cashFlows.map((row) => (
      row.kind === kind && row.category === from ? { ...row, category: to } : row
    )),
    vendorRules: data.vendorRules.map((row) => (
      row.kind === kind && row.category === from ? { ...row, category: to } : row
    )),
    actuals: data.actuals.map((row) => (
      row.kind === kind && row.category === from ? { ...row, category: to } : row
    )),
    budgets,
  }
}

async function remapCategoryRowsRemotely(
  user: AuthUser,
  kind: AppCategory['kind'],
  from: string,
  to: string,
  dropBudget: boolean,
): Promise<void> {
  if (!supabase) return
  for (const table of ['cash_flows', 'vendor_rules', 'actuals'] as const) {
    const { error } = await supabase.from(table).update({ category: to })
      .eq('user_id', user.id).eq('kind', kind).eq('category', from)
    if (error) throw error
  }
  if (kind !== 'expense') return
  if (dropBudget) {
    const { error } = await supabase.from('budgets').delete()
      .eq('user_id', user.id).eq('category', from)
    if (error) throw error
  } else {
    const { error } = await supabase.from('budgets').update({ category: to })
      .eq('user_id', user.id).eq('category', from)
    if (error) throw error
  }
}

export async function addCategory(user: AuthUser, input: CategoryInput): Promise<AppCategory> {
  const name = input.name.trim()
  const kind = input.kind === 'income' ? 'income' : 'expense'
  if (!name) throw new Error('Please enter a category name.')
  const current = await loadData(user)
  if (current.categories.some((row) => row.kind === kind && row.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('That category already exists.')
  }
  const row: AppCategory = { ...input, id: makeId(), user_id: user.id, name, kind }
  if (usingSupabase && supabase) {
    const { created_at: _created, ...insertRow } = row
    void _created
    const { error } = await supabase.from('categories').insert(insertRow)
    if (error && !isMissingTable(error.code)) throw error
    if (error) {
      await persistCategories(user, (data) => ({ ...data, categories: [...data.categories, row] }))
    }
  } else {
    await persistCategories(user, (data) => ({ ...data, categories: [...data.categories, row] }))
  }
  return row
}

export async function renameCategory(user: AuthUser, id: string, name: string): Promise<void> {
  const clean = name.trim()
  if (!clean) throw new Error('Please enter a category name.')
  const current = await loadData(user)
  const category = current.categories.find((row) => row.id === id)
  if (!category) throw new Error('That category no longer exists.')
  if (category.name.toLowerCase() === 'other') throw new Error('Other is the fallback category and cannot be renamed.')
  if (current.categories.some((row) => row.id !== id && row.kind === category.kind
    && row.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error('That category already exists.')
  }
  const from = category.name
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('categories').update({ name: clean })
      .eq('user_id', user.id).eq('id', id)
    if (error && !isMissingTable(error.code)) throw error
    if (error) {
      await persistCategories(user, (data) => ({
        ...remapCategoryReferencesLocally(data, category.kind, from, clean, false),
        categories: data.categories.map((row) => (row.id === id ? { ...row, name: clean } : row)),
      }))
      return
    }
    if (from !== clean) await remapCategoryRowsRemotely(user, category.kind, from, clean, false)
    return
  }
  await persistCategories(user, (data) => ({
    ...remapCategoryReferencesLocally(data, category.kind, from, clean, false),
    categories: data.categories.map((row) => (row.id === id ? { ...row, name: clean } : row)),
  }))
}

export async function deleteCategory(user: AuthUser, id: string): Promise<void> {
  const current = await loadData(user)
  const category = current.categories.find((row) => row.id === id)
  if (!category) return
  if (category.name.toLowerCase() === 'other') throw new Error('Other is the fallback category and cannot be removed.')
  const fallback = current.categories.find((row) => row.kind === category.kind && row.name.toLowerCase() === 'other')?.name ?? 'Other'
  const dropBudget = current.budgets.some((budget) => budget.category === fallback)
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('categories').delete().eq('user_id', user.id).eq('id', id)
    if (error && !isMissingTable(error.code)) throw error
    if (error) {
      await persistCategories(user, (data) => ({
        ...remapCategoryReferencesLocally(data, category.kind, category.name, fallback, dropBudget),
        categories: data.categories.filter((row) => row.id !== id),
      }))
      return
    }
    await remapCategoryRowsRemotely(user, category.kind, category.name, fallback, dropBudget)
    return
  }
  await persistCategories(user, (data) => ({
    ...remapCategoryReferencesLocally(data, category.kind, category.name, fallback, dropBudget),
    categories: data.categories.filter((row) => row.id !== id),
  }))
}

export async function addAccount(user: AuthUser, input: AccountInput): Promise<Account> {
  const row: Account = {
    ...input,
    id: makeId(),
    user_id: user.id,
    opening_balance: Math.max(0, Number(input.opening_balance) || 0),
    name: input.name.trim(),
    kind: input.kind === 'cash' || input.kind === 'bank' ? input.kind : 'other',
  }
  if (!row.name) throw new Error('Please name this account.')
  if (usingSupabase && supabase) {
    const { created_at: _created, ...insertRow } = row
    void _created
    const { error } = await supabase.from('accounts').insert(insertRow).select().single()
    if (error) throw error
  } else {
    const stored = await loadData(user)
    writeJSON(KEYS.data(user.id), normalizeData({ ...stored, accounts: [...stored.accounts, row] }))
  }
  const current = await loadData(user)
  await syncProfileFromAccounts(user, current.accounts)
  return row
}

export async function updateAccount(user: AuthUser, id: string, patch: Partial<AccountInput>): Promise<void> {
  if (usingSupabase && supabase) {
    const clean: Record<string, unknown> = { ...patch }
    if (clean.opening_balance !== undefined) clean.opening_balance = Math.max(0, Number(clean.opening_balance) || 0)
    if (clean.name !== undefined) clean.name = String(clean.name).trim()
    const { error } = await supabase.from('accounts').update(clean).eq('user_id', user.id).eq('id', id)
    if (error) throw error
  } else {
    await updateLocal(user, (data) => ({
      ...data,
      accounts: data.accounts.map((account) => (account.id === id ? { ...account, ...patch } : account)),
    }))
  }
  const current = await loadData(user)
  await syncProfileFromAccounts(user, current.accounts)
}

export async function deleteAccount(user: AuthUser, id: string): Promise<void> {
  if (id === 'cash' || id === 'bank') throw new Error('Cash and bank accounts are built in and cannot be removed.')
  if (usingSupabase && supabase) {
    const tables = [
      ['cash_flows', 'account'],
      ['loans', 'account'],
      ['loan_payments', 'account'],
      ['actuals', 'account'],
      ['vendor_rules', 'account'],
    ] as const
    for (const [table, column] of tables) {
      const { error } = await supabase.from(table).update({ [column]: 'bank' }).eq('user_id', user.id).eq(column, id)
      if (error) throw error
    }
    for (const column of ['from_account', 'to_account'] as const) {
      const { error } = await supabase.from('transfers').update({ [column]: 'bank' }).eq('user_id', user.id).eq(column, id)
      if (error) throw error
    }
    const { error } = await supabase.from('accounts').delete().eq('user_id', user.id).eq('id', id)
    if (error) throw error
  } else {
    await updateLocal(user, (data) => ({
      ...data,
      accounts: data.accounts.filter((account) => account.id !== id),
      cashFlows: data.cashFlows.map((row) => (row.account === id ? { ...row, account: 'bank' } : row)),
      loans: data.loans.map((row) => (row.account === id ? { ...row, account: 'bank' } : row)),
      loanPayments: data.loanPayments.map((row) => (row.account === id ? { ...row, account: 'bank' } : row)),
      actuals: data.actuals.map((row) => (row.account === id ? { ...row, account: 'bank' } : row)),
      vendorRules: data.vendorRules.map((row) => (row.account === id ? { ...row, account: 'bank' } : row)),
      transfers: data.transfers.map((row) => ({
        ...row,
        from_account: row.from_account === id ? 'bank' : row.from_account,
        to_account: row.to_account === id ? 'bank' : row.to_account,
      })),
    }))
  }
  const current = await loadData(user)
  await syncProfileFromAccounts(user, current.accounts)
}

export async function addTransfer(user: AuthUser, input: TransferInput): Promise<Transfer> {
  const row: Transfer = {
    ...input,
    id: makeId(),
    user_id: user.id,
    amount: Math.max(0, Number(input.amount) || 0),
    date: input.date,
    note: input.note.trim(),
  }
  if (row.amount <= 0) throw new Error('Enter an amount greater than zero.')
  if (row.from_account === row.to_account) throw new Error('Choose two different accounts.')
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase.from('transfers').insert(insertRow).select().single()
    if (error) throw error
    return ensureNumbers(data as unknown as Record<string, unknown>) as unknown as Transfer
  }
  await updateLocal(user, (data) => ({ ...data, transfers: [row, ...data.transfers] }))
  return row
}

export async function deleteTransfer(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('transfers').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({ ...data, transfers: data.transfers.filter((row) => row.id !== id) }))
}

export async function upsertMonthlyIncome(user: AuthUser, input: MonthlyIncomeInput): Promise<MonthlyIncome> {
  const row: MonthlyIncome = {
    ...input,
    day: Math.max(1, Math.min(31, Math.round(Number(input.day) || 1))),
    id: makeId(),
    user_id: user.id,
  }
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase
      .from('monthly_incomes')
      .upsert(insertRow, { onConflict: 'user_id,month' })
      .select()
      .single()
    if (error) throw error
    return ensureNumbers(data as unknown as Record<string, unknown>) as unknown as MonthlyIncome
  }
  await updateLocal(user, (current) => ({
    ...current,
    monthlyIncomes: [
      row,
      ...current.monthlyIncomes.filter((entry) => entry.month !== input.month),
    ].sort((a, b) => a.month.localeCompare(b.month)),
  }))
  return row
}

export async function deleteMonthlyIncome(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('monthly_incomes').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    monthlyIncomes: data.monthlyIncomes.filter((entry) => entry.id !== id),
  }))
}

export async function addCashFlow(user: AuthUser, input: CashFlowInput): Promise<CashFlow> {
  const row: CashFlow = { ...input, id: makeId(), user_id: user.id }
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase.from('cash_flows').insert(insertRow).select().single()
    if (error) throw error
    return ensureNumbers(data as unknown as Record<string, unknown>) as unknown as CashFlow
  }
  await updateLocal(user, (current) => ({ ...current, cashFlows: [row, ...current.cashFlows] }))
  return row
}

export async function updateCashFlow(user: AuthUser, id: string, patch: Partial<CashFlowInput>): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('cash_flows').update(patch).eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    cashFlows: data.cashFlows.map((flow) => (flow.id === id ? { ...flow, ...patch } : flow)),
  }))
}

export async function deleteCashFlow(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('cash_flows').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    cashFlows: data.cashFlows.filter((flow) => flow.id !== id),
    cashFlowOverrides: data.cashFlowOverrides.filter((override) => override.cash_flow_id !== id),
    cashFlowMoves: data.cashFlowMoves.filter((move) => move.cash_flow_id !== id),
    cashFlowSkips: data.cashFlowSkips.filter((skip) => skip.cash_flow_id !== id),
    actuals: data.actuals.filter((actual) => actual.cash_flow_id !== id),
  }))
}

export async function upsertCashFlowOverride(user: AuthUser, input: CashFlowOverrideInput): Promise<CashFlowOverride> {
  const row: CashFlowOverride = { ...input, id: makeId(), user_id: user.id }
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase
      .from('cash_flow_overrides')
      .upsert(insertRow, { onConflict: 'user_id,cash_flow_id,month' })
      .select()
      .single()
    if (error) throw error
    return ensureNumbers(data as unknown as Record<string, unknown>) as unknown as CashFlowOverride
  }
  await updateLocal(user, (current) => ({
    ...current,
    cashFlowOverrides: [
      row,
      ...current.cashFlowOverrides.filter(
        (override) => override.cash_flow_id !== input.cash_flow_id || override.month !== input.month,
      ),
    ].sort((a, b) => a.month.localeCompare(b.month)),
  }))
  return row
}

export async function deleteCashFlowOverride(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('cash_flow_overrides').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    cashFlowOverrides: data.cashFlowOverrides.filter((override) => override.id !== id),
  }))
}

export async function upsertCashFlowMove(user: AuthUser, input: CashFlowMoveInput): Promise<CashFlowMove> {
  const row: CashFlowMove = { ...input, id: makeId(), user_id: user.id }
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase
      .from('cash_flow_moves')
      .upsert(insertRow, { onConflict: 'user_id,cash_flow_id,from_date' })
      .select()
      .single()
    if (error) throw error
    return data as unknown as CashFlowMove
  }
  await updateLocal(user, (current) => ({
    ...current,
    cashFlowMoves: [
      row,
      ...current.cashFlowMoves.filter(
        (move) => move.cash_flow_id !== input.cash_flow_id || move.from_date !== input.from_date,
      ),
    ].sort((a, b) => a.from_date.localeCompare(b.from_date)),
  }))
  return row
}

export async function deleteCashFlowMove(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('cash_flow_moves').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    cashFlowMoves: data.cashFlowMoves.filter((move) => move.id !== id),
  }))
}

export async function upsertCashFlowSkip(user: AuthUser, input: CashFlowSkipInput): Promise<CashFlowSkip> {
  const row: CashFlowSkip = { ...input, id: makeId(), user_id: user.id }
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase
      .from('cash_flow_skips')
      .upsert(insertRow, { onConflict: 'user_id,cash_flow_id,date' })
      .select()
      .single()
    if (error) throw error
    return data as unknown as CashFlowSkip
  }
  await updateLocal(user, (current) => ({
    ...current,
    cashFlowSkips: [
      row,
      ...current.cashFlowSkips.filter(
        (skip) => skip.cash_flow_id !== input.cash_flow_id || skip.date !== input.date,
      ),
    ].sort((a, b) => a.date.localeCompare(b.date)),
  }))
  return row
}

export async function deleteCashFlowSkip(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('cash_flow_skips').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    cashFlowSkips: data.cashFlowSkips.filter((skip) => skip.id !== id),
  }))
}

function normalizeBudgetInput(input: BudgetInput): BudgetInput {
  return {
    ...input,
    monthly_limit: Math.max(0, Number(input.monthly_limit) || 0),
    period: input.period === 'yearly' || input.period === 'one_time' ? input.period : 'monthly',
    start_date: input.start_date || '1970-01-01',
    name: (input.name ?? '').trim(),
    cash_flow_id: null,
    rollover: input.period === 'yearly' || input.period === 'one_time' ? false : input.rollover !== false,
  }
}

async function findBudget(user: AuthUser, id: string): Promise<Budget | undefined> {
  if (usingSupabase && supabase) {
    const { data, error } = await supabase
      .from('budgets')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) throw error
    return (data ?? undefined) as Budget | undefined
  }
  return (await loadData(user)).budgets.find((budget) => budget.id === id)
}

async function writeBudget(
  user: AuthUser,
  input: BudgetInput,
  mode: 'insert' | 'upsert',
): Promise<Budget> {
  const clean = normalizeBudgetInput({ ...input, cash_flow_id: null })
  const row: Budget = {
    ...clean,
    id: makeId(),
    user_id: user.id,
  }
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, cash_flow_id: _link, ...insertRow } = row
    void _id
    void _created
    void _link
    const query = supabase.from('budgets')
    const { data, error } = mode === 'insert'
      ? await query.insert(insertRow).select().single()
      : await query.upsert(insertRow, { onConflict: 'user_id,category,period,start_date' }).select().single()
    if (error) throw error
    return ensureNumbers(data as unknown as Record<string, unknown>) as unknown as Budget
  }
  await updateLocal(user, (current) => ({
    ...current,
    budgets: [
      row,
      ...(mode === 'insert'
        ? current.budgets
        : current.budgets.filter((budget) => budgetKey(budget) !== budgetKey(row))),
    ].sort((a, b) => budgetKey(a).localeCompare(budgetKey(b))),
  }))
  return row
}

export async function addBudget(user: AuthUser, input: BudgetInput): Promise<Budget> {
  return writeBudget(user, input, 'insert')
}

export async function upsertBudget(user: AuthUser, input: BudgetInput): Promise<Budget> {
  return writeBudget(user, input, 'upsert')
}

export async function updateBudget(user: AuthUser, id: string, patch: Partial<BudgetInput>): Promise<void> {
  const current = await findBudget(user, id)
  if (!current) throw new Error('That planned spend no longer exists.')
  const merged = normalizeBudgetInput({ ...current, ...patch, cash_flow_id: null })
  const budgetPatch: Partial<BudgetInput> = {
    category: merged.category,
    name: merged.name,
    monthly_limit: merged.monthly_limit,
    period: merged.period,
    start_date: merged.start_date,
    rollover: merged.rollover,
  }
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('budgets').update(budgetPatch).eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    budgets: data.budgets
      .map((budget) => (budget.id === id
        ? {
            ...merged,
            id: budget.id,
            user_id: budget.user_id,
            cash_flow_id: null,
            created_at: budget.created_at,
          }
        : budget))
      .sort((a, b) => budgetKey(a).localeCompare(budgetKey(b))),
  }))
}

export async function deleteBudget(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('budgets').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    const { error: actualError } = await supabase
      .from('actuals')
      .delete()
      .eq('user_id', user.id)
      .like('event_key', `budget-${id}-%`)
    if (actualError) throw actualError
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    budgets: data.budgets.filter((budget) => budget.id !== id),
    actuals: data.actuals.filter((actual) => !actual.event_key.startsWith(`budget-${id}-`)),
  }))
}

export async function upsertGoal(user: AuthUser, input: GoalInput): Promise<Goal> {
  const row: Goal = {
    ...input,
    target_amount: Math.max(0, Number(input.target_amount) || 0),
    current_amount: Math.max(0, Number(input.current_amount) || 0),
    monthly_contribution: Math.max(0, Number(input.monthly_contribution) || 0),
    id: makeId(),
    user_id: user.id,
  }
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase.from('goals').insert(insertRow).select().single()
    if (error) throw error
    return ensureNumbers(data as unknown as Record<string, unknown>) as unknown as Goal
  }
  await updateLocal(user, (current) => ({ ...current, goals: [row, ...current.goals] }))
  return row
}

export async function updateGoal(user: AuthUser, id: string, patch: Partial<GoalInput>): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('goals').update(patch).eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    goals: data.goals.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal)),
  }))
}

export async function deleteGoal(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('goals').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    goals: data.goals.filter((goal) => goal.id !== id),
  }))
}

/** Record an actual set-aside as one balanced transfer into the fund. */
export async function contributeToGoal(
  user: AuthUser,
  id: string,
  amount: number,
  fromAccount = 'bank',
): Promise<void> {
  const value = Math.max(0, Number(amount) || 0)
  if (value <= 0) throw new Error('Enter an amount greater than zero.')

  const current = await loadData(user)
  const goal = current.goals.find((entry) => entry.id === id)
  if (!goal) throw new Error('That savings fund no longer exists.')
  const toAccount = goalFundAccountId(goal, current.accounts)
  if (fromAccount === toAccount) throw new Error('Choose a different account to contribute from.')

  const row: Transfer = {
    id: makeId(),
    user_id: user.id,
    from_account: fromAccount,
    to_account: toAccount,
    amount: value,
    date: toDateInputValue(),
    note: `Savings fund · ${goal.name}`,
    created_at: new Date().toISOString(),
  }
  const updatedAmount = Math.max(0, Number(goal.current_amount) || 0) + value

  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data: transfer, error: transferError } = await supabase
      .from('transfers')
      .insert(insertRow)
      .select()
      .single()
    if (transferError) throw transferError
    const { error: goalError } = await supabase
      .from('goals')
      .update({ current_amount: updatedAmount })
      .eq('id', id)
      .eq('user_id', user.id)
    if (goalError) {
      await supabase.from('transfers').delete().eq('id', transfer.id).eq('user_id', user.id)
      throw goalError
    }
    return
  }

  await updateLocal(user, (data) => ({
    ...data,
    transfers: [row, ...data.transfers],
    goals: data.goals.map((entry) => (
      entry.id === id ? { ...entry, current_amount: updatedAmount } : entry
    )),
  }))
}

/** Turn a savings fund into a real planned spend with a linked cash flow. */
export async function moveGoalToBudget(user: AuthUser, id: string, input: BudgetInput): Promise<Budget> {
  const current = await loadData(user)
  if (!current.goals.some((goal) => goal.id === id)) {
    throw new Error('That savings fund no longer exists.')
  }
  const budget = await addBudget(user, input)
  try {
    await deleteGoal(user, id)
  } catch (caught) {
    await deleteBudget(user, budget.id).catch(() => undefined)
    throw caught
  }
  return budget
}

export async function upsertActual(user: AuthUser, input: ActualInput): Promise<Actual> {
  const row: Actual = {
    ...input,
    amount: Math.max(0, Number(input.amount) || 0),
    id: makeId(),
    user_id: user.id,
  }
  if (row.date > toDateInputValue() && !isSmsImport(row)) {
    throw new Error('Record actual amounts only on or before the planned date.')
  }
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase
      .from('actuals')
      .upsert(insertRow, { onConflict: 'user_id,event_key' })
      .select()
      .single()
    if (error) throw error
    return ensureNumbers(data as unknown as Record<string, unknown>) as unknown as Actual
  }
  await updateLocal(user, (current) => ({
    ...current,
    actuals: [
      row,
      ...current.actuals.filter((actual) => actual.event_key !== input.event_key),
    ].sort((a, b) => b.date.localeCompare(a.date)),
  }))
  return row
}

export async function deleteActual(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('actuals').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    actuals: data.actuals.filter((actual) => actual.id !== id),
  }))
}

export async function deleteSmsImports(user: AuthUser): Promise<void> {
  if (usingSupabase && supabase) {
    const { data: flows, error: lookupError } = await supabase
      .from('cash_flows')
      .select('id')
      .eq('user_id', user.id)
      .eq('source', 'sms')
    if (lookupError) throw lookupError

    const { error: actualError } = await supabase
      .from('actuals')
      .delete()
      .eq('user_id', user.id)
      .eq('source', 'sms')
    if (actualError) throw actualError

    const ids = (flows ?? []).map((flow) => flow.id as string)
    if (ids.length > 0) {
      const results = await Promise.all([
        supabase.from('cash_flow_overrides').delete().eq('user_id', user.id).in('cash_flow_id', ids),
        supabase.from('cash_flow_moves').delete().eq('user_id', user.id).in('cash_flow_id', ids),
        supabase.from('cash_flow_skips').delete().eq('user_id', user.id).in('cash_flow_id', ids),
      ])
      const dependentError = results.find((result) => result.error)?.error
      if (dependentError) throw dependentError

      const { error: flowError } = await supabase
        .from('cash_flows')
        .delete()
        .eq('user_id', user.id)
        .in('id', ids)
      if (flowError) throw flowError
    }
    return
  }

  await updateLocal(user, (data) => {
    const ids = new Set(data.cashFlows.filter(isSmsImport).map((flow) => flow.id))
    return {
      ...data,
      cashFlows: data.cashFlows.filter((flow) => !ids.has(flow.id)),
      cashFlowOverrides: data.cashFlowOverrides.filter((row) => !ids.has(row.cash_flow_id)),
      cashFlowMoves: data.cashFlowMoves.filter((row) => !ids.has(row.cash_flow_id)),
      cashFlowSkips: data.cashFlowSkips.filter((row) => !ids.has(row.cash_flow_id)),
      actuals: data.actuals.filter(
        (actual) => !isSmsImport(actual) && !(actual.cash_flow_id && ids.has(actual.cash_flow_id)),
      ),
    }
  })
}

export async function addLoan(user: AuthUser, input: LoanInput): Promise<Loan> {
  const row: Loan = { ...input, id: makeId(), user_id: user.id }
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase.from('loans').insert(insertRow).select().single()
    if (error) throw error
    return ensureNumbers(data as unknown as Record<string, unknown>) as unknown as Loan
  }
  await updateLocal(user, (data) => ({ ...data, loans: [row, ...data.loans] }))
  return row
}

export async function updateLoan(user: AuthUser, id: string, patch: Partial<LoanInput>): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('loans').update(patch).eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    loans: data.loans.map((loan) => (loan.id === id ? { ...loan, ...patch } : loan)),
  }))
}

export async function deleteLoan(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('loans').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    loans: data.loans.filter((loan) => loan.id !== id),
    loanPayments: data.loanPayments.filter((payment) => payment.loan_id !== id),
  }))
}

export async function addLoanPayment(user: AuthUser, input: LoanPaymentInput): Promise<LoanPayment> {
  // A payment dated today (or earlier) has actually happened, so it reduces the
  // recorded loan balance. Later dates remain planned cash flows in the forecast.
  const applied = input.payment_date <= toDateInputValue()
  const row: LoanPayment = { ...input, applied_to_balance: applied, id: makeId(), user_id: user.id }

  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase.from('loan_payments').insert(insertRow).select().single()
    if (error) throw error
    if (applied) {
      const { data: loan } = await supabase
        .from('loans')
        .select('outstanding')
        .eq('id', input.loan_id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (loan) {
        const { error: updateError } = await supabase
          .from('loans')
          .update({ outstanding: Math.max(0, Number(loan.outstanding) - input.amount) })
          .eq('id', input.loan_id)
          .eq('user_id', user.id)
        if (updateError) throw updateError
      }
    }
    return ensureNumbers(data as unknown as Record<string, unknown>) as unknown as LoanPayment
  }

  await updateLocal(user, (current) => ({
    ...current,
    loanPayments: [row, ...current.loanPayments],
    loans: applied
      ? current.loans.map((loan) =>
          loan.id === input.loan_id
            ? { ...loan, outstanding: Math.max(0, loan.outstanding - input.amount) }
            : loan,
        )
      : current.loans,
  }))
  return row
}

export async function deleteLoanPayment(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { data: payment } = await supabase
      .from('loan_payments')
      .select('loan_id, amount, applied_to_balance')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!payment) return
    const { error } = await supabase.from('loan_payments').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    if (payment.applied_to_balance) {
      const { data: loan } = await supabase
        .from('loans')
        .select('principal, outstanding')
        .eq('id', payment.loan_id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (loan) {
        const restored = Math.min(Number(loan.principal), Number(loan.outstanding) + Number(payment.amount))
        const { error: updateError } = await supabase
          .from('loans')
          .update({ outstanding: restored })
          .eq('id', payment.loan_id)
          .eq('user_id', user.id)
        if (updateError) throw updateError
      }
    }
    return
  }

  await updateLocal(user, (data) => {
    const payment = data.loanPayments.find((candidate) => candidate.id === id)
    return {
      ...data,
      loanPayments: data.loanPayments.filter((candidate) => candidate.id !== id),
      loans: payment?.applied_to_balance
        ? data.loans.map((loan) =>
            loan.id === payment.loan_id
              ? { ...loan, outstanding: Math.min(loan.principal, loan.outstanding + payment.amount) }
              : loan,
          )
        : data.loans,
    }
  })
}

// ---------------------------------------------------------------------------
// JSON export / import (portable backups and demo -> Supabase migration)
// ---------------------------------------------------------------------------

export interface LocalDemoAccount {
  id: string
  email: string
  name: string
  hasData: boolean
}

/** Demo accounts still stored in this browser, even while Supabase is enabled. */
export function listLocalDemoAccounts(): LocalDemoAccount[] {
  return localUsers().map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    hasData: Boolean(readJSON<AppData | null>(KEYS.data(user.id), null)?.profile),
  }))
}

export function buildDataExport(user: AuthUser, data: AppData): DataExport {
  return {
    app: 'finplannar',
    version: 2,
    exportedAt: new Date().toISOString(),
    source: { mode: usingSupabase ? 'supabase' : 'local', userId: user.id },
    account: {
      display_name: data.profile.display_name || user.name,
      email: user.email,
    },
    data: normalizeData(data),
  }
}

/** Export a demo account directly from localStorage (works in Supabase mode too). */
export function exportLocalDemoData(userId: string): DataExport | null {
  const localUser = localUsers().find((user) => user.id === userId)
  if (!localUser) return null
  const stored = readJSON<AppData | null>(KEYS.data(userId), null)
  if (!stored?.profile) return null
  return {
    app: 'finplannar',
    version: 2,
    exportedAt: new Date().toISOString(),
    source: { mode: 'local', userId },
    account: {
      display_name: stored.profile.display_name || localUser.name,
      email: localUser.email,
    },
    data: normalizeData(stored),
  }
}

export function parseDataExport(text: string): DataExport {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  if (!raw || typeof raw !== 'object') throw new Error('That file does not contain a FinPlannar export.')
  const envelope = raw as Partial<DataExport>
  if (envelope.app !== 'finplannar') throw new Error('That JSON was not exported from FinPlannar.')
  if (envelope.version !== 1 && envelope.version !== 2) {
    throw new Error(`Unsupported export version: ${String(envelope.version)}.`)
  }
  if (!envelope.data || typeof envelope.data !== 'object' || !(envelope.data as AppData).profile) {
    throw new Error('That export is missing its planner data.')
  }
  const source = envelope.source
  const account = envelope.account
  return {
    app: 'finplannar',
    version: envelope.version === 2 ? 2 : 1,
    exportedAt: typeof envelope.exportedAt === 'string' ? envelope.exportedAt : new Date().toISOString(),
    source: {
      mode: source?.mode === 'supabase' ? 'supabase' : 'local',
      userId: typeof source?.userId === 'string' ? source.userId : '',
    },
    account: {
      display_name: typeof account?.display_name === 'string'
        ? account.display_name
        : (envelope.data as AppData).profile.display_name || '',
      email: typeof account?.email === 'string' ? account.email : '',
    },
    data: normalizeData(envelope.data as AppData),
  }
}

/** New ids everywhere, with every reference and stable actual key updated. */
function remapData(data: AppData, userId: string): AppData {
  const idMap = new Map<string, string>()
  const freshId = (oldId: string | null | undefined): string => {
    if (!oldId) return makeId()
    let next = idMap.get(oldId)
    if (!next) {
      next = makeId()
      idMap.set(oldId, next)
    }
    return next
  }
  const accountRef = (oldId: string | undefined): string => {
    if (!oldId || oldId === 'cash' || oldId === 'bank') return oldId || 'bank'
    return freshId(oldId)
  }

  const categories = data.categories.map((row) => ({
    ...row,
    id: row.id.startsWith('default-') ? row.id : freshId(row.id),
    user_id: userId,
  }))
  const accounts = data.accounts.map((row) => ({
    ...row,
    id: row.id === 'cash' || row.id === 'bank' ? row.id : freshId(row.id),
    user_id: userId,
  }))
  const transfers = data.transfers.map((row) => ({
    ...row,
    id: freshId(row.id),
    user_id: userId,
    from_account: accountRef(row.from_account),
    to_account: accountRef(row.to_account),
  }))

  const monthlyIncomes = data.monthlyIncomes.map((row) => ({
    ...row, id: freshId(row.id), user_id: userId,
  }))
  const cashFlows = data.cashFlows.map((row) => ({
    ...row, id: freshId(row.id), user_id: userId, account: accountRef(row.account),
  }))
  const cashFlowOverrides = data.cashFlowOverrides.map((row) => ({
    ...row, id: freshId(row.id), user_id: userId, cash_flow_id: freshId(row.cash_flow_id),
  }))
  const cashFlowMoves = data.cashFlowMoves.map((row) => ({
    ...row, id: freshId(row.id), user_id: userId, cash_flow_id: freshId(row.cash_flow_id),
  }))
  const cashFlowSkips = data.cashFlowSkips.map((row) => ({
    ...row, id: freshId(row.id), user_id: userId, cash_flow_id: freshId(row.cash_flow_id),
  }))
  const budgets = data.budgets.map((row) => ({
    ...row,
    id: freshId(row.id),
    user_id: userId,
    cash_flow_id: row.cash_flow_id ? freshId(row.cash_flow_id) : null,
  }))
  const goals = data.goals.map((row) => ({
    ...row, id: freshId(row.id), user_id: userId,
  }))
  const vendorRules = data.vendorRules.map((row) => ({
    ...row, id: freshId(row.id), user_id: userId, account: accountRef(row.account),
  }))
  const loans = data.loans.map((row) => ({
    ...row, id: freshId(row.id), user_id: userId, account: accountRef(row.account),
  }))
  const loanPayments = data.loanPayments.map((row) => ({
    ...row, id: freshId(row.id), user_id: userId, loan_id: freshId(row.loan_id), account: accountRef(row.account),
  }))

  // Actual keys are `${cashFlowId}-${timestamp}` (or `income-YYYY-MM`). Swap the
  // leading id so a recorded amount still attaches to its recreated occurrence.
  const oldIds = [...idMap.keys()].sort((a, b) => b.length - a.length)
  const remapEventKey = (key: string): string => {
    const prefix = oldIds.find((oldId) => key.startsWith(`${oldId}-`))
    return prefix ? `${String(idMap.get(prefix))}-${key.slice(prefix.length + 1)}` : key
  }
  const actuals = data.actuals.map((row) => ({
    ...row,
    id: freshId(row.id),
    user_id: userId,
    cash_flow_id: row.cash_flow_id ? freshId(row.cash_flow_id) : null,
    account: accountRef(row.account),
    event_key: remapEventKey(row.event_key),
  }))

  return normalizeData({
    profile: { ...data.profile, user_id: userId },
    categories,
    accounts,
    transfers,
    monthlyIncomes,
    cashFlows,
    cashFlowOverrides,
    cashFlowMoves,
    cashFlowSkips,
    budgets,
    goals,
    vendorRules,
    actuals,
    loans,
    loanPayments,
  })
}

/** Local merge mirrors Supabase upserts: imported rows win on the same key. */
function mergeData(current: AppData, incoming: AppData): AppData {
  const by = <T>(rows: T[], key: (row: T) => string): T[] => {
    const map = new Map<string, T>()
    rows.forEach((row) => map.set(key(row), row))
    return [...map.values()]
  }
  return normalizeData({
    profile: incoming.profile,
    categories: by([...current.categories, ...incoming.categories], (row) => `${row.kind}:${row.name.toLowerCase()}`),
    accounts: by([...current.accounts, ...incoming.accounts], (row) => row.id),
    transfers: by([...current.transfers, ...incoming.transfers], (row) => row.id),
    monthlyIncomes: by([...current.monthlyIncomes, ...incoming.monthlyIncomes], (row) => row.month),
    cashFlows: by([...current.cashFlows, ...incoming.cashFlows], (row) => row.id),
    cashFlowOverrides: by(
      [...current.cashFlowOverrides, ...incoming.cashFlowOverrides],
      (row) => `${row.cash_flow_id}|${row.month}`,
    ),
    cashFlowMoves: by(
      [...current.cashFlowMoves, ...incoming.cashFlowMoves],
      (row) => `${row.cash_flow_id}|${row.from_date}`,
    ),
    cashFlowSkips: by(
      [...current.cashFlowSkips, ...incoming.cashFlowSkips],
      (row) => `${row.cash_flow_id}|${row.date}`,
    ),
    budgets: by([...current.budgets, ...incoming.budgets], (row) => budgetKey(row)),
    goals: by([...current.goals, ...incoming.goals], (row) => row.id),
    vendorRules: by([...current.vendorRules, ...incoming.vendorRules], (row) => row.vendor_key),
    actuals: by([...current.actuals, ...incoming.actuals], (row) => row.event_key),
    loans: by([...current.loans, ...incoming.loans], (row) => row.id),
    loanPayments: by([...current.loanPayments, ...incoming.loanPayments], (row) => row.id),
  })
}

export async function importDataExport(
  user: AuthUser,
  payload: DataExport,
  replace: boolean,
): Promise<void> {
  const imported = remapData(payload.data, user.id)

  if (!usingSupabase || !supabase) {
    const current = replace ? defaultData(user.id, user.name) : await loadData(user)
    writeJSON(KEYS.data(user.id), replace ? imported : mergeData(current, imported))
    return
  }

  const client = supabase
  if (replace) {
    // Children first: no row may point at a parent that is about to disappear.
    const children = [
      'actuals',
      'cash_flow_overrides',
      'cash_flow_moves',
      'cash_flow_skips',
      'loan_payments',
      'loans',
      'cash_flows',
      'budgets',
      'goals',
      'vendor_rules',
      'monthly_incomes',
      'transfers',
      'categories',
      'accounts',
    ]
    for (const table of children) {
      const { error } = await client.from(table).delete().eq('user_id', user.id)
      if (error && !(table === 'categories' && isMissingTable(error.code))) throw error
    }
  }

  const writeRows = async (table: string, rows: unknown[], onConflict?: string): Promise<void> => {
    if (!rows.length) return
    const cleaned = rows.map((row) => {
      const { created_at: _created, ...rest } = row as Record<string, unknown>
      void _created
      return rest
    })
    const result = onConflict
      ? await client.from(table).upsert(cleaned, { onConflict: onConflict })
      : await client.from(table).insert(cleaned)
    if (result.error) throw result.error
  }

  await writeRows('profiles', [{ ...imported.profile, updated_at: new Date().toISOString() }], 'user_id')
  try {
    await writeRows('categories', imported.categories, 'user_id,id')
  } catch (caught) {
    const code = (caught as { code?: string }).code
    if (!isMissingTable(code)) throw caught
  }
  await writeRows('accounts', imported.accounts, 'user_id,id')
  await writeRows('transfers', imported.transfers, 'id')
  await writeRows('cash_flows', imported.cashFlows)
  await writeRows('monthly_incomes', imported.monthlyIncomes, 'user_id,month')
  await writeRows('cash_flow_overrides', imported.cashFlowOverrides, 'user_id,cash_flow_id,month')
  await writeRows('cash_flow_moves', imported.cashFlowMoves, 'user_id,cash_flow_id,from_date')
  await writeRows('cash_flow_skips', imported.cashFlowSkips, 'user_id,cash_flow_id,date')
  await writeRows('budgets', imported.budgets, 'user_id,category,period,start_date')
  await writeRows('goals', imported.goals)
  await writeRows('vendor_rules', imported.vendorRules, 'user_id,vendor_key')
  await writeRows('loans', imported.loans)
  await writeRows('loan_payments', imported.loanPayments)
  await writeRows('actuals', imported.actuals, 'user_id,event_key')
}

export { defaultProfile }
