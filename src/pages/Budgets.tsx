import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Repeat, Trash2, Wallet } from 'lucide-react'
import Modal from '../components/Modal'
import { buildBudgetStatuses } from '../lib/budgets'
import { categoriesOfKind } from '../lib/categories'
import { formatMoney, formatSigned } from '../lib/format'
import type { AppActions, AppData, Budget, NewBudget, Simulation } from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  simulation: Simulation
  currency: string
  onNotify: (message: string) => void
}

type ModalState = { mode: 'add' } | { mode: 'edit'; budget: Budget }

function blankBudget(categories: string[] = ['Other']): NewBudget {
  return { category: categories[0] ?? 'Other', monthly_limit: 0, rollover: false }
}

export default function Budgets({ data, actions, simulation, currency, onNotify }: Props) {
  const [modal, setModal] = useState<ModalState | null>(null)
  const [form, setForm] = useState<NewBudget>(blankBudget())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const categories = categoriesOfKind(data.categories, 'expense')
  const statuses = useMemo(() => buildBudgetStatuses(data, simulation.months), [data, simulation.months])
  const totalLimit = statuses.reduce((sum, status) => sum + status.budget.monthly_limit, 0)
  const currentSpent = statuses.reduce((sum, status) => sum + (status.months[0]?.spent ?? 0), 0)
  const currentRemaining = statuses.reduce((sum, status) => sum + status.currentRemaining, 0)
  const overCount = statuses.filter((status) => status.currentRemaining < 0).length

  function openAdd() {
    const used = new Set(data.budgets.map((budget) => budget.category))
    const category = categories.find((item) => !used.has(item)) ?? categories[0] ?? 'Other'
    setForm({ ...blankBudget(categories), category })
    setModal({ mode: 'add' })
  }

  function openEdit(budget: Budget) {
    setForm({ category: budget.category, monthly_limit: budget.monthly_limit, rollover: budget.rollover })
    setModal({ mode: 'edit', budget })
  }

  async function save() {
    if (!modal || busy) return
    if (!form.category.trim() || form.monthly_limit <= 0) {
      onNotify('Enter a category and a monthly limit above zero.')
      return
    }
    try {
      setBusy(true)
      if (modal.mode === 'edit' && modal.budget.category !== form.category) {
        await actions.deleteBudget(modal.budget.id)
      }
      await actions.upsertBudget(form)
      onNotify('Budget saved.')
      setModal(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not save this budget.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(budget: Budget) {
    if (!window.confirm(`Remove the ${budget.category} budget?`)) return
    try {
      await actions.deleteBudget(budget.id)
      onNotify('Budget removed.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not remove this budget.')
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Plan</span>
          <h1>Category budgets</h1>
          <p>Set a monthly limit per category and see how planned and recorded spending measure up.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Add budget</button>
        </div>
      </header>

      <div className="stat-strip">
        <div><span>Budgets</span><strong>{statuses.length}</strong></div>
        <div><span>Monthly limits</span><strong>{formatMoney(totalLimit, currency)}</strong></div>
        <div><span>Current month spend</span><strong>{formatMoney(currentSpent, currency)}</strong></div>
        <div><span>Remaining</span><strong className={currentRemaining < 0 ? 'negative' : 'positive'}>{formatSigned(currentRemaining, currency)}</strong></div>
      </div>

      {overCount > 0 && (
        <div className="alert-strip alert-warn">
          {overCount} {overCount === 1 ? 'category is' : 'categories are'} over budget for the current month.
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Budget overview</h2>
            <p>Spend uses recorded amounts where available, otherwise the planned forecast amount.</p>
          </div>
          <span className={`status-pill ${overCount > 0 ? 'pill-red' : 'pill-teal'}`}>
            {overCount > 0 ? `${overCount} over limit` : 'On track'}
          </span>
        </div>

        {statuses.length ? (
          <div className="budget-list">
            {statuses.map((status) => {
              const first = status.months[0]
              const isOpen = expanded === status.budget.id
              const pct = status.budget.monthly_limit > 0
                ? Math.min(100, ((first?.spent ?? 0) / status.budget.monthly_limit) * 100)
                : 0
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
                      <strong>{status.budget.category}</strong>
                      <span>{status.budget.rollover ? 'Rollover on' : 'Resets monthly'}</span>
                    </div>
                    <strong className="budget-limit">{formatMoney(status.budget.monthly_limit, currency)}<small>/mo</small></strong>
                    <div className="budget-progress">
                      <div className="progress-track">
                        <div className={`progress-fill ${status.currentRemaining < 0 ? 'progress-over' : ''}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span>{formatMoney(first?.spent ?? 0, currency)} spent · {formatMoney(first?.available ?? status.budget.monthly_limit, currency)} available</span>
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
                        <div className="mini-table-row" key={row.key}>
                          <span>{row.label}</span>
                          <span>{formatMoney(row.planned, currency)}</span>
                          <span>{formatMoney(row.recorded, currency)}</span>
                          <span>{formatMoney(row.carriedIn, currency)}</span>
                          <span>{formatMoney(row.available, currency)}</span>
                          <span>{formatMoney(row.spent, currency)}</span>
                          <span className={row.remaining < 0 ? 'negative' : ''}>{formatSigned(row.remaining, currency)}</span>
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
            <span>Add a category limit to compare your plan against what you actually spend.</span>
            <button className="btn btn-primary btn-small" onClick={openAdd}>Add budget</button>
          </div>
        )}
      </section>

      {modal && (
        <Modal
          title={modal.mode === 'edit' ? 'Edit budget' : 'Add budget'}
          subtitle="Limits apply every month. Rollover moves unused budget forward."
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
              <span>Monthly limit ({currency})</span>
              <input
                type="number"
                min="1"
                step="0.01"
                value={form.monthly_limit || ''}
                onChange={(event) => setForm({ ...form, monthly_limit: Number(event.target.value) })}
              />
            </label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.rollover}
              onChange={(event) => setForm({ ...form, rollover: event.target.checked })}
            />
            <span><Repeat size={14} /> Carry unused budget (and overspend) into the next month</span>
          </label>
          <div className="dialog-actions">
            <button className="btn btn-outline btn-small" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void save()}>Save budget</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
