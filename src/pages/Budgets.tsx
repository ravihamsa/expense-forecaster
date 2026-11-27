import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Repeat, Trash2, Wallet } from 'lucide-react'
import Modal from '../components/Modal'
import { budgetPeriodLabel, budgetTitle, buildBudgetStatuses } from '../lib/budgets'
import type { BudgetExpense } from '../lib/budgets'
import { categoriesOfKind } from '../lib/categories'
import { formatDate, formatMoney, formatSigned } from '../lib/format'
import { toDateInputValue } from '../lib/schedule'
import type { AppActions, AppData, Budget, BudgetPeriod, NewBudget, Simulation } from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  simulation: Simulation
  currency: string
  onNotify: (message: string) => void
}

type ModalState = { mode: 'add' } | { mode: 'edit'; budget: Budget }

function blankBudget(categories: string[] = ['Other']): NewBudget {
  return {
    category: categories[0] ?? 'Other',
    name: '',
    monthly_limit: 0,
    rollover: false,
    period: 'monthly',
    start_date: toDateInputValue(),
  }
}

function ExpenseBreakdown({ expenses, currency }: { expenses: BudgetExpense[]; currency: string }) {
  if (expenses.length === 0) {
    return <p className="budget-expense-empty">No individual expenses were linked to this over-limit month.</p>
  }
  return (
    <div className="budget-expense-list">
      {expenses.map((expense) => (
        <div className="budget-expense-row" key={expense.id}>
          <div className="budget-expense-main">
            <strong>{expense.name}</strong>
            <span>
              {formatDate(expense.date)}
              {expense.accountLabel ? ` · ${expense.accountLabel}` : ''}
              {expense.note ? ` · ${expense.note}` : ''}
            </span>
          </div>
          <span className="budget-expense-tag">
            {expense.source}
            {expense.recorded !== undefined && expense.recorded !== expense.planned
              ? ` · planned ${formatMoney(expense.planned, currency)}`
              : ''}
          </span>
          <strong className="budget-expense-amount">{formatMoney(expense.counted, currency)}</strong>
        </div>
      ))}
    </div>
  )
}

export default function Budgets({ data, actions, simulation, currency, onNotify }: Props) {
  const [modal, setModal] = useState<ModalState | null>(null)
  const [form, setForm] = useState<NewBudget>(blankBudget())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const today = toDateInputValue()
  const categories = categoriesOfKind(data.categories, 'expense')
  const statuses = useMemo(() => buildBudgetStatuses(data, simulation.months), [data, simulation.months])
  const futurePlans = useMemo(
    () => simulation.months.flatMap((month) => month.events
      .filter((event) => event.kind === 'expense' && event.source === 'cash_flow' && event.date > today)
      .map((event) => ({ event, monthLabel: month.monthLabel }))),
    [simulation.months, today],
  )
  const totalLimit = statuses.reduce((sum, status) => sum + status.budget.monthly_limit, 0)
  const currentSpent = statuses.reduce((sum, status) => sum + (status.currentRow?.spent ?? 0), 0)
  const currentRemaining = statuses.reduce((sum, status) => sum + status.currentRemaining, 0)
  const overCount = statuses.filter((status) => status.currentRemaining < 0).length
  const futureTotal = futurePlans.reduce((sum, row) => sum + row.event.amount, 0)
  const futureRecorded = futurePlans.reduce((sum, row) => sum + (row.event.actualAmount ?? 0), 0)

  function openAdd() {
    const used = new Set(data.budgets
      .filter((budget) => (budget.period ?? 'monthly') === 'monthly')
      .map((budget) => budget.category))
    const category = categories.find((item) => !used.has(item)) ?? categories[0] ?? 'Other'
    setForm({ ...blankBudget(categories), category })
    setModal({ mode: 'add' })
  }

  function openEdit(budget: Budget) {
    setForm({
      category: budget.category,
      name: budget.name ?? '',
      monthly_limit: budget.monthly_limit,
      rollover: budget.rollover,
      period: budget.period ?? 'monthly',
      start_date: budget.start_date ?? toDateInputValue(),
    })
    setModal({ mode: 'edit', budget })
  }

  async function save() {
    if (!modal || busy) return
    const period: BudgetPeriod = form.period ?? 'monthly'
    if (!form.category.trim() || form.monthly_limit <= 0) {
      onNotify('Enter a category and an allocation above zero.')
      return
    }
    if (period !== 'monthly' && !form.start_date) {
      onNotify('Choose a start date for this allocation.')
      return
    }
    try {
      setBusy(true)
      const payload: NewBudget = { ...form, period, start_date: period === 'monthly' ? '1970-01-01' : form.start_date }
      if (modal.mode === 'edit') {
        await actions.updateBudget(modal.budget.id, payload)
      } else {
        await actions.upsertBudget(payload)
      }
      onNotify('Budget saved.')
      setModal(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not save this budget.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(budget: Budget) {
    if (!window.confirm(`Remove the ${budgetTitle(budget)} allocation?`)) return
    try {
      await actions.deleteBudget(budget.id)
      onNotify('Budget removed.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not remove this budget.')
    }
  }

  const activePeriod = form.period ?? 'monthly'

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Plan</span>
          <h1>Budgets & allocations</h1>
          <p>Set a monthly limit, a yearly total, or a one-time allocation. Record the real spending later as an actual.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Add budget</button>
        </div>
      </header>

      <div className="stat-strip">
        <div><span>Allocations</span><strong>{statuses.length}</strong></div>
        <div><span>Total allocated</span><strong>{formatMoney(totalLimit, currency)}</strong></div>
        <div><span>Spent in current period</span><strong>{formatMoney(currentSpent, currency)}</strong></div>
        <div><span>Remaining</span><strong className={currentRemaining < 0 ? 'negative' : 'positive'}>{formatSigned(currentRemaining, currency)}</strong></div>
      </div>

      {overCount > 0 && (
        <div className="alert-strip alert-warn">
          {overCount} {overCount === 1 ? 'allocation is' : 'allocations are'} over their limit in the current period.
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Budget overview</h2>
            <p>Monthly limits use planned amounts until an actual exists. Dated allocations count only recorded actuals, so a future plan is never shown as spent.</p>
          </div>
          <span className={`status-pill ${overCount > 0 ? 'pill-red' : 'pill-teal'}`}>
            {overCount > 0 ? `${overCount} over limit` : 'On track'}
          </span>
        </div>

        {statuses.length ? (
          <div className="budget-list">
            {statuses.map((status) => {
              const first = status.currentRow
              const isOpen = expanded === status.budget.id
              const period = status.budget.period ?? 'monthly'
              const displaySpent = period === 'monthly' ? (first?.spent ?? 0) : (first?.recorded ?? 0)
              const pct = status.budget.monthly_limit > 0
                ? Math.min(100, (displaySpent / status.budget.monthly_limit) * 100)
                : 0
              const name = budgetTitle(status.budget)
              const subtitle = status.budget.name?.trim()
                ? `${budgetPeriodLabel(status.budget)} · ${status.budget.category}`
                : budgetPeriodLabel(status.budget)
              return (
                <div className="budget-item" key={status.budget.id}>
                  <div className="budget-row">
                    <button
                      className="icon-button"
                      onClick={() => setExpanded(isOpen ? null : status.budget.id)}
                      aria-label={isOpen ? 'Collapse months' : 'Expand months'}
                      title={isOpen ? 'Collapse months' : 'Expand months'}
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                    <div className="budget-name">
                      <strong>{name}</strong>
                      <span>{subtitle}{!first?.active ? ' · not in forecast window' : ''}</span>
                    </div>
                    <strong className="budget-limit">
                      {formatMoney(status.budget.monthly_limit, currency)}
                      <small>{period === 'monthly' ? '/mo' : period === 'yearly' ? '/yr' : ''}</small>
                    </strong>
                    <div className="budget-progress">
                      <div className="progress-track">
                        <div className={`progress-fill ${status.currentRemaining < 0 ? 'progress-over' : ''}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span>{formatMoney(displaySpent, currency)} spent · {formatMoney(first?.available ?? status.budget.monthly_limit, currency)} available</span>
                    </div>
                    <strong className={status.currentRemaining < 0 ? 'negative' : 'positive'}>
                      {formatSigned(status.currentRemaining, currency)}
                    </strong>
                    <div className="row-actions">
                      <button className="icon-button" title="Edit budget" onClick={() => openEdit(status.budget)}><Pencil size={16} /></button>
                      <button className="icon-button danger" title="Delete budget" onClick={() => void remove(status.budget)}><Trash2 size={16} /></button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="budget-months">
                      <div className="mini-table-head">
                        <span>Month</span><span>Planned</span><span>Recorded</span><span>Carried in</span><span>Available</span><span>Spent</span><span>Remaining</span>
                      </div>
                      {status.months.map((row) => (
                        <div className="budget-month-group" key={row.key}>
                          <div className="mini-table-row">
                            <span>{row.label}{row.active ? '' : ' ·'}</span>
                            <span>{formatMoney(row.planned, currency)}</span>
                            <span>{formatMoney(row.recorded, currency)}</span>
                            <span>{formatMoney(row.carriedIn, currency)}</span>
                            <span>{formatMoney(row.available, currency)}</span>
                            <span>{formatMoney(row.spent, currency)}</span>
                            <span className={row.remaining < 0 ? 'negative' : ''}>{formatSigned(row.remaining, currency)}</span>
                          </div>
                          {row.remaining < 0 && (
                            <div className="budget-month-detail">
                              <span className="budget-expense-label">
                                Caused by · {formatMoney(Math.abs(row.remaining), currency)} over limit
                              </span>
                              <ExpenseBreakdown expenses={row.expenses} currency={currency} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-state">
            <Wallet size={30} />
            <strong>No budgets yet</strong>
            <span>Add a monthly, yearly or one-time allocation to compare your plan against what you actually spend.</span>
            <button className="btn btn-primary btn-small" onClick={openAdd}>Add budget</button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Future expense plans</h2>
            <p>Every expense cash-flow entry dated after today appears here as an allocation. Add the actual amount from Actual vs plan when it happens.</p>
          </div>
          <span className="status-pill">{futurePlans.length} planned · {formatMoney(futureTotal, currency)}</span>
        </div>
        {futurePlans.length ? (
          <div className="ledger-list">
            {futurePlans.map(({ event, monthLabel }) => (
              <div className="ledger-row" key={event.id}>
                <div className="ledger-main">
                  <strong>{event.name}</strong>
                  <span>{monthLabel} · {formatDate(event.date)} · {event.category}</span>
                </div>
                <strong>{formatMoney(event.amount, currency)}</strong>
                <span className={event.actualAmount !== undefined && event.actualAmount !== null ? 'positive' : ''}>
                  {event.actualAmount !== undefined && event.actualAmount !== null
                    ? `Recorded ${formatMoney(event.actualAmount, currency)}`
                    : 'Awaiting actual'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Wallet size={26} />
            <strong>No future-dated expenses</strong>
            <span>Add a one-time expense in Cash flow for a future date and it will show up here.</span>
          </div>
        )}
        {futurePlans.length > 0 && (
          <p className="preview-empty">Recorded so far against these plans: {formatMoney(futureRecorded, currency)}.</p>
        )}
      </section>

      {modal && (
        <Modal
          title={modal.mode === 'edit' ? 'Edit allocation' : 'Add allocation'}
          subtitle="Monthly limits repeat every month. Yearly totals and one-time amounts use their start date."
          onClose={() => setModal(null)}
        >
          <div className="form-grid">
            <label className="field">
              <span>Category</span>
              <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Name (optional)</span>
              <input value={form.name ?? ''} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Farm house build" />
            </label>
            <label className="field">
              <span>Allocation amount ({currency})</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={form.monthly_limit || ''}
                onChange={(event) => setForm({ ...form, monthly_limit: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Allocation type</span>
              <select value={activePeriod} onChange={(event) => setForm({ ...form, period: event.target.value as BudgetPeriod })}>
                <option value="monthly">Monthly limit</option>
                <option value="yearly">Yearly total</option>
                <option value="one_time">One-time allocation</option>
              </select>
            </label>
            {activePeriod !== 'monthly' && (
              <label className="field">
                <span>{activePeriod === 'yearly' ? 'Year starts' : 'Allocation date'}</span>
                <input
                  type="date"
                  value={form.start_date ?? ''}
                  onChange={(event) => setForm({ ...form, start_date: event.target.value })}
                />
              </label>
            )}
          </div>
          {activePeriod === 'monthly' && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={form.rollover}
                onChange={(event) => setForm({ ...form, rollover: event.target.checked })}
              />
              <span><Repeat size={14} /> Carry unused budget (and overspend) into the next month</span>
            </label>
          )}
          <div className="dialog-actions">
            <button className="btn btn-outline btn-small" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void save()}>Save budget</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
