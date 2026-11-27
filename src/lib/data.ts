import { toDateInputValue } from './schedule'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import type {
  Actual,
  AppData,
  Budget,
  CashFlow,
  CashFlowMove,
  CashFlowOverride,
  CashFlowSkip,
  Goal,
  Loan,
  LoanPayment,
  MonthlyIncome,
  Profile,
} from './types'

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

function defaultData(userId: string, displayName: string): AppData {
  return {
    profile: defaultProfile(userId, displayName),
    monthlyIncomes: [],
    cashFlows: [],
    cashFlowOverrides: [],
    cashFlowMoves: [],
    cashFlowSkips: [],
    budgets: [],
    goals: [],
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
  return {
    ...data,
    profile: normalizeProfile(data.profile),
    monthlyIncomes: (data.monthlyIncomes ?? []).map((entry) => ({
      ...entry,
      amount: Number(entry.amount) || 0,
      day: Math.max(1, Math.min(31, Math.round(Number(entry.day) || 1))),
      note: entry.note ?? '',
    })),
    cashFlowOverrides: (data.cashFlowOverrides ?? []).map((override) => ({
      ...override,
      amount: Number(override.amount) || 0,
    })),
    cashFlowMoves: data.cashFlowMoves ?? [],
    cashFlowSkips: data.cashFlowSkips ?? [],
    budgets: (data.budgets ?? []).map((budget) => ({
      ...budget,
      monthly_limit: Number(budget.monthly_limit) || 0,
      rollover: budget.rollover ?? false,
    })),
    goals: (data.goals ?? []).map((goal) => ({
      ...goal,
      target_amount: Number(goal.target_amount) || 0,
      current_amount: Number(goal.current_amount) || 0,
      monthly_contribution: Number(goal.monthly_contribution) || 0,
      target_date: goal.target_date ?? null,
      note: goal.note ?? '',
    })),
    actuals: (data.actuals ?? []).map((actual) => ({
      ...actual,
      amount: Number(actual.amount) || 0,
      cash_flow_id: actual.cash_flow_id ?? null,
      note: actual.note ?? '',
    })),
    cashFlows: (data.cashFlows ?? []).map((flow) => ({
      ...flow,
      account: flow.account === 'cash' ? 'cash' : 'bank',
    })),
    loanPayments: (data.loanPayments ?? []).map((payment) => ({
      ...payment,
      account: payment.account === 'cash' ? 'cash' : 'bank',
      applied_to_balance: payment.applied_to_balance ?? false,
    })),
    loans: (data.loans ?? []).map((loan) => ({
      ...loan,
      account: loan.account === 'cash' ? 'cash' : 'bank',
      direction: loan.direction ?? 'borrowed',
      repayment_type: loan.repayment_type ?? 'emi',
      due_date: loan.due_date ?? null,
    })),
  }
}

export async function loadData(user: AuthUser): Promise<AppData> {
  if (usingSupabase && supabase) {
    const [
      profileResult,
      incomesResult,
      flowsResult,
      overridesResult,
      movesResult,
      skipsResult,
      budgetsResult,
      goalsResult,
      actualsResult,
      loansResult,
      paymentsResult,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('monthly_incomes').select('*').eq('user_id', user.id).order('month', { ascending: true }),
      supabase.from('cash_flows').select('*').eq('user_id', user.id).order('start_date', { ascending: false }),
      supabase.from('cash_flow_overrides').select('*').eq('user_id', user.id).order('month', { ascending: true }),
      supabase.from('cash_flow_moves').select('*').eq('user_id', user.id).order('from_date', { ascending: true }),
      supabase.from('cash_flow_skips').select('*').eq('user_id', user.id).order('date', { ascending: true }),
      supabase.from('budgets').select('*').eq('user_id', user.id).order('category', { ascending: true }),
      supabase.from('goals').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('actuals').select('*').eq('user_id', user.id).order('date', { ascending: false }),
      supabase.from('loans').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('loan_payments').select('*').eq('user_id', user.id).order('payment_date', { ascending: false }),
    ])
    if (profileResult.error) throw profileResult.error
    if (incomesResult.error) throw incomesResult.error
    if (flowsResult.error) throw flowsResult.error
    if (overridesResult.error) throw overridesResult.error
    if (movesResult.error) throw movesResult.error
    if (skipsResult.error) throw skipsResult.error
    if (budgetsResult.error) throw budgetsResult.error
    if (goalsResult.error) throw goalsResult.error
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
    return normalizeData({
      profile,
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
  }

  const stored = readJSON<AppData | null>(KEYS.data(user.id), null)
  if (stored?.profile) return normalizeData(stored)
  const fresh = defaultData(user.id, user.name)
  writeJSON(KEYS.data(user.id), fresh)
  return fresh
}

async function updateLocal(user: AuthUser, updater: (data: AppData) => AppData): Promise<void> {
  const data = await loadData(user)
  writeJSON(KEYS.data(user.id), updater(data))
}

export async function saveProfile(user: AuthUser, patch: ProfilePatch): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase
      .from('profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    profile: { ...data.profile, ...patch, updated_at: new Date().toISOString() },
  }))
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

export async function upsertBudget(user: AuthUser, input: BudgetInput): Promise<Budget> {
  const row: Budget = {
    ...input,
    monthly_limit: Math.max(0, Number(input.monthly_limit) || 0),
    id: makeId(),
    user_id: user.id,
  }
  if (usingSupabase && supabase) {
    const { id: _id, created_at: _created, ...insertRow } = row
    void _id
    void _created
    const { data, error } = await supabase
      .from('budgets')
      .upsert(insertRow, { onConflict: 'user_id,category' })
      .select()
      .single()
    if (error) throw error
    return ensureNumbers(data as unknown as Record<string, unknown>) as unknown as Budget
  }
  await updateLocal(user, (current) => ({
    ...current,
    budgets: [
      row,
      ...current.budgets.filter((budget) => budget.category !== input.category),
    ].sort((a, b) => a.category.localeCompare(b.category)),
  }))
  return row
}

export async function deleteBudget(user: AuthUser, id: string): Promise<void> {
  if (usingSupabase && supabase) {
    const { error } = await supabase.from('budgets').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return
  }
  await updateLocal(user, (data) => ({
    ...data,
    budgets: data.budgets.filter((budget) => budget.id !== id),
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

export async function upsertActual(user: AuthUser, input: ActualInput): Promise<Actual> {
  const row: Actual = {
    ...input,
    amount: Math.max(0, Number(input.amount) || 0),
    id: makeId(),
    user_id: user.id,
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

export { defaultProfile }
