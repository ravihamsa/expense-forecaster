import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import AuthScreen from './components/AuthScreen'
import CashFlowForm from './components/CashFlowForm'
import Layout from './components/Layout'
import Modal from './components/Modal'
import * as api from './lib/data'
import type { AuthUser } from './lib/data'
import { simulate } from './lib/projections'
import Accounts from './pages/Accounts'
import Actuals from './pages/Actuals'
import BalancePlan from './pages/BalancePlan'
import Budgets from './pages/Budgets'
import CalendarPage from './pages/CalendarPage'
import CashFlows from './pages/CashFlows'
import Categories from './pages/Categories'
import Dashboard from './pages/Dashboard'
import Goals from './pages/Goals'
import Ledger from './pages/Ledger'
import Loans from './pages/Loans'
import Settings from './pages/Settings'
import type { AppActions, AppData, FlowKind, SimulationOptions, Tab } from './lib/types'

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [data, setData] = useState<AppData | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [options, setOptions] = useState<SimulationOptions>({
    expenseCutPct: 0,
    extraLoanPayment: 0,
    extraPaymentLoanId: 'highest_rate',
  })
  const [quickAdd, setQuickAdd] = useState<FlowKind | null>(null)
  const [toast, setToast] = useState('')
  const [fatalError, setFatalError] = useState('')
  const syncedUsers = useRef<Record<string, boolean>>({})

  const notify = useCallback((message: string) => setToast(message), [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    let active = true
    const unsubscribe = api.onAuthChange((next) => {
      if (!active) return
      setUser(next)
      if (!next) {
        setData(null)
        setTab('dashboard')
      }
    })
    api.getCurrentUser()
      .then((next) => {
        if (!active) return
        setUser(next)
        setAuthLoading(false)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setFatalError(caught instanceof Error ? caught.message : 'Could not check your session.')
        setAuthLoading(false)
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const refresh = useCallback(async (current: AuthUser) => {
    const fresh = await api.loadData(current)
    setData(fresh)
    return fresh
  }, [])

  useEffect(() => {
    if (!user || syncedUsers.current[user.id]) return
    syncedUsers.current[user.id] = true
    let active = true
    setLoadingData(true)
    refresh(user)
      .catch((caught: unknown) => {
        if (active) setFatalError(caught instanceof Error ? caught.message : 'Could not load your data.')
      })
      .finally(() => {
        if (active) setLoadingData(false)
      })
    return () => {
      active = false
    }
  }, [user?.id, refresh])

  useEffect(() => {
    if (!user) return
    setOptions({ expenseCutPct: 0, extraLoanPayment: 0, extraPaymentLoanId: 'highest_rate' })
  }, [user?.id])

  const actions = useMemo<AppActions>(() => {
    const run = async (operation: () => Promise<void>, message: string) => {
      if (!user) return
      await operation()
      await refresh(user)
      notify(message)
    }
    return {
      saveProfile: (patch) => run(() => api.saveProfile(user!, patch), 'Settings saved.'),
      addCategory: (input) => run(() => api.addCategory(user!, input).then(() => undefined), 'Category added.'),
      renameCategory: (id, name) => run(() => api.renameCategory(user!, id, name), 'Category renamed.'),
      setCategoryIcon: (id, icon) => run(() => api.setCategoryIcon(user!, id, icon), 'Category icon saved.'),
      deleteCategory: (id) => run(() => api.deleteCategory(user!, id), 'Category removed.'),
      addAccount: (input) => run(() => api.addAccount(user!, input).then(() => undefined), 'Account added.'),
      updateAccount: (id, patch) => run(() => api.updateAccount(user!, id, patch), 'Account updated.'),
      deleteAccount: (id) => run(() => api.deleteAccount(user!, id), 'Account removed.'),
      addTransfer: (input) => run(() => api.addTransfer(user!, input).then(() => undefined), 'Transfer recorded.'),
      deleteTransfer: (id) => run(() => api.deleteTransfer(user!, id), 'Transfer removed.'),
      upsertMonthlyIncome: (input) => run(() => api.upsertMonthlyIncome(user!, input).then(() => undefined), 'Income plan saved.'),
      deleteMonthlyIncome: (id) => run(() => api.deleteMonthlyIncome(user!, id), 'Income plan removed.'),
      addCashFlow: (input) => run(() => api.addCashFlow(user!, input).then(() => undefined), 'Cash flow added.'),
      updateCashFlow: (id, patch) => run(() => api.updateCashFlow(user!, id, patch), 'Cash flow updated.'),
      deleteCashFlow: (id) => run(() => api.deleteCashFlow(user!, id), 'Cash flow deleted.'),
      upsertCashFlowOverride: (input) => run(() => api.upsertCashFlowOverride(user!, input).then(() => undefined), 'Fixed amount saved.'),
      deleteCashFlowOverride: (id) => run(() => api.deleteCashFlowOverride(user!, id), 'Fixed amount removed.'),
      upsertCashFlowMove: (input) => run(() => api.upsertCashFlowMove(user!, input).then(() => undefined), 'Entry moved.'),
      deleteCashFlowMove: (id) => run(() => api.deleteCashFlowMove(user!, id), 'Original date restored.'),
      upsertCashFlowSkip: (input) => run(() => api.upsertCashFlowSkip(user!, input).then(() => undefined), 'Entry skipped for this date.'),
      deleteCashFlowSkip: (id) => run(() => api.deleteCashFlowSkip(user!, id), 'Entry restored.'),
      upsertBudget: (input) => run(() => api.upsertBudget(user!, input).then(() => undefined), 'Plan saved.'),
      updateBudget: (id, patch) => run(() => api.updateBudget(user!, id, patch), 'Plan updated.'),
      deleteBudget: (id) => run(() => api.deleteBudget(user!, id), 'Plan removed.'),
      upsertGoal: (input) => run(() => api.upsertGoal(user!, input).then(() => undefined), 'Goal added.'),
      updateGoal: (id, patch) => run(() => api.updateGoal(user!, id, patch), 'Goal updated.'),
      deleteGoal: (id) => run(() => api.deleteGoal(user!, id), 'Goal removed.'),
      contributeToGoal: (id, amount, fromAccount) =>
        run(() => api.contributeToGoal(user!, id, amount, fromAccount), 'Contribution recorded.'),
      moveGoalToBudget: (id, input) =>
        run(() => api.moveGoalToBudget(user!, id, input).then(() => undefined), 'Moved to Planned spends.'),
      upsertActual: (input) => run(() => api.upsertActual(user!, input).then(() => undefined), 'Actual amount saved.'),
      deleteActual: (id) => run(() => api.deleteActual(user!, id), 'Actual amount removed.'),
      deleteSmsImports: () => run(() => api.deleteSmsImports(user!), 'SMS imports removed.'),
      addLoan: (input) => run(() => api.addLoan(user!, input).then(() => undefined), 'Loan added.'),
      updateLoan: (id, patch) => run(() => api.updateLoan(user!, id, patch), 'Loan updated.'),
      deleteLoan: (id) => run(() => api.deleteLoan(user!, id), 'Loan removed.'),
      addLoanPayment: (input) => run(() => api.addLoanPayment(user!, input).then(() => undefined), 'Payment recorded.'),
      deleteLoanPayment: (id) => run(() => api.deleteLoanPayment(user!, id), 'Payment removed.'),
      importData: (payload, replace) => run(
        () => api.importDataExport(user!, payload, replace).then(() => undefined),
        'Data imported.',
      ),
    }
  }, [user, refresh, notify])

  const baseSimulation = useMemo(() => (data ? simulate(data) : null), [data])
  const simulation = useMemo(() => (data ? simulate(data, options) : null), [data, options])

  async function handleQuickAdd(input: Parameters<AppActions['addCashFlow']>[0]) {
    await actions.addCashFlow(input)
    setQuickAdd(null)
  }

  async function handleSignOut() {
    try {
      await api.signOut()
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Could not sign out.')
    }
  }

  if (authLoading) {
    return <div className="loading-screen"><span className="spinner" /><p>Loading your plan…</p></div>
  }

  if (!user) {
    return <AuthScreen />
  }

  if (loadingData || !data || !baseSimulation || !simulation) {
    return (
      <div className="loading-screen">
        <span className="spinner" />
        <p>{fatalError || 'Building your forecast…'}</p>
        {fatalError && <button className="btn btn-outline btn-small" onClick={() => window.location.reload()}>Retry</button>}
      </div>
    )
  }

  return (
    <>
      <Layout user={user} activeTab={tab} onTabChange={setTab} onSignOut={handleSignOut}>
        {tab === 'dashboard' && (
          <Dashboard
            data={data}
            simulation={baseSimulation}
            actions={actions}
            onNotify={notify}
            onNavigate={setTab}
            onAdd={(kind) => {
              if (kind === 'expense') {
                setTab('budgets')
                return
              }
              setQuickAdd('income')
            }}
            onAddLoan={() => setTab('loans')}
          />
        )}
        {tab === 'cashflows' && <CashFlows data={data} actions={actions} onNotify={notify} />}
        {tab === 'categories' && <Categories data={data} actions={actions} onNotify={notify} />}
        {tab === 'budgets' && <Budgets data={data} actions={actions} simulation={baseSimulation} currency={data.profile.currency || 'INR'} onNotify={notify} />}
        {tab === 'goals' && <Goals data={data} actions={actions} simulation={baseSimulation} currency={data.profile.currency || 'INR'} onNotify={notify} />}
        {tab === 'actuals' && <Actuals data={data} actions={actions} simulation={baseSimulation} currency={data.profile.currency || 'INR'} onNotify={notify} />}
        {tab === 'accounts' && (
          <Accounts data={data} actions={actions} simulation={baseSimulation} onNotify={notify} />
        )}
        {tab === 'loans' && (
          <Loans
            data={data}
            actions={actions}
            onNotify={notify}
            onPayFaster={(loanId) => {
              setOptions((previous) => ({ ...previous, extraPaymentLoanId: loanId, extraLoanPayment: previous.extraLoanPayment || 1000 }))
              setTab('balance')
            }}
          />
        )}
        {tab === 'balance' && (
          <BalancePlan
            data={data}
            baseSimulation={baseSimulation}
            simulation={simulation}
            options={options}
            onOptionsChange={setOptions}
            onNavigate={setTab}
          />
        )}
        {tab === 'calendar' && (
          <CalendarPage
            data={data}
            months={baseSimulation.months}
            actions={actions}
            onNotify={notify}
          />
        )}
        {tab === 'ledger' && <Ledger data={data} />}
        {tab === 'settings' && <Settings data={data} actions={actions} user={user} onNotify={notify} />}
      </Layout>

      {quickAdd && (
        <Modal
          title="Add income"
          subtitle="Set a schedule so it appears in future forecasts."
          onClose={() => setQuickAdd(null)}
          wide
        >
          <CashFlowForm
            defaultKind={quickAdd}
            accounts={data.accounts}
            categories={data.categories}
            currency={data.profile.currency}
            onCancel={() => setQuickAdd(null)}
            onSave={handleQuickAdd}
          />
        </Modal>
      )}

      {toast && (
        <div className="toast"><CheckCircle2 size={17} /> {toast}</div>
      )}
    </>
  )
}
