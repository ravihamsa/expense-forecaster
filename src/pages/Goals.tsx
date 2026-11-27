import { useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, CircleAlert, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import Modal from '../components/Modal'
import { buildGoalsSummary, goalFundAccountId, type GoalStatus } from '../lib/goals'
import { categoriesOfKind } from '../lib/categories'
import { formatMoney, formatSigned } from '../lib/format'
import { toDateInputValue } from '../lib/schedule'
import type {
  AppActions,
  AppData,
  BudgetPeriod,
  Goal,
  NewBudget,
  NewGoal,
  Simulation,
} from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  simulation: Simulation
  currency: string
  onNotify: (message: string) => void
}

type ModalState =
  | { mode: 'add' }
  | { mode: 'edit'; goal: Goal }
  | { mode: 'contribute'; goal: Goal }
  | { mode: 'move'; goal: Goal }

function blankGoal(): NewGoal {
  return {
    name: '',
    target_amount: 0,
    current_amount: 0,
    monthly_contribution: 0,
    target_date: null,
    note: '',
  }
}

const CATEGORY_HINTS: [RegExp, string][] = [
  [/farm|house|home|build|construct|renovat|repair/i, 'Housing'],
  [/trip|travel|holiday|flight|tour|vacation/i, 'Travel'],
  [/car|bike|vehicle|scooter/i, 'Transport'],
  [/school|college|course|education|fee/i, 'Education'],
  [/medical|health|hospital|operation/i, 'Health'],
  [/wedding|party|celebration|function/i, 'Lifestyle'],
]

function inferGoalCategory(goal: Goal, categories: string[]): string {
  const found = CATEGORY_HINTS.find(([pattern]) => pattern.test(goal.name))?.[1]
  if (found && categories.includes(found)) return found
  return categories.includes('Other') ? 'Other' : categories[0] ?? 'Other'
}

function blankMoveBudget(goal: Goal, categories: string[]): NewBudget {
  const period: BudgetPeriod = goal.monthly_contribution > 0 && !goal.target_date ? 'monthly' : 'one_time'
  return {
    category: inferGoalCategory(goal, categories),
    name: goal.name,
    monthly_limit: period === 'monthly' ? goal.monthly_contribution : goal.target_amount,
    rollover: false,
    period,
    start_date: goal.target_date || toDateInputValue(),
  }
}

export default function Goals({ data, actions, simulation, currency, onNotify }: Props) {
  const [modal, setModal] = useState<ModalState | null>(null)
  const [form, setForm] = useState<NewGoal>(blankGoal())
  const [contribution, setContribution] = useState('')
  const [contributionFrom, setContributionFrom] = useState('bank')
  const [moveForm, setMoveForm] = useState<NewBudget>({
    category: 'Other',
    name: '',
    monthly_limit: 0,
    rollover: false,
    period: 'one_time',
    start_date: toDateInputValue(),
  })
  const [busy, setBusy] = useState(false)

  const summary = useMemo(() => buildGoalsSummary(data, simulation), [data, simulation])
  const completed = summary.statuses.filter((status) => status.remaining <= 0).length
  const accounts = data.accounts ?? []
  const categories = categoriesOfKind(data.categories, 'expense')
  const accountName = (id: string): string => accounts.find((account) => account.id === id)?.name ?? id
  const contributionDestination = modal?.mode === 'contribute'
    ? goalFundAccountId(modal.goal, accounts)
    : ''

  function openAdd() {
    setForm(blankGoal())
    setModal({ mode: 'add' })
  }

  function openEdit(goal: Goal) {
    setForm({
      name: goal.name,
      target_amount: goal.target_amount,
      current_amount: goal.current_amount,
      monthly_contribution: goal.monthly_contribution,
      target_date: goal.target_date,
      note: goal.note,
    })
    setModal({ mode: 'edit', goal })
  }

  function openContribute(goal: Goal) {
    setContribution(String(goal.monthly_contribution || 0))
    const destination = goalFundAccountId(goal, data.accounts ?? [])
    const source = (data.accounts ?? []).find((account) => account.id === 'bank' && account.id !== destination)
      ?? (data.accounts ?? []).find((account) => account.id !== destination)
    setContributionFrom(source?.id ?? 'bank')
    setModal({ mode: 'contribute', goal })
  }

  function openMove(goal: Goal) {
    if (!window.confirm(`Move "${goal.name}" out of Savings funds and into Planned spends?`)) return
    setMoveForm(blankMoveBudget(goal, categories))
    setModal({ mode: 'move', goal })
  }

  async function save() {
    if (!modal || busy) return
    if (modal.mode === 'move') {
      const amount = Number(moveForm.monthly_limit)
      const period: BudgetPeriod = moveForm.period ?? 'one_time'
      if (!moveForm.category.trim() || !Number.isFinite(amount) || amount <= 0) {
        onNotify('Choose a category and an amount above zero.')
        return
      }
      if (period !== 'monthly' && !moveForm.start_date) {
        onNotify('Choose the date for this planned spend.')
        return
      }
      try {
        setBusy(true)
        const payload: NewBudget = {
          ...moveForm,
          name: (moveForm.name || modal.goal.name).trim(),
          monthly_limit: amount,
          period,
          start_date: period === 'monthly' ? '1970-01-01' : moveForm.start_date,
        }
        await actions.moveGoalToBudget(modal.goal.id, payload)
        onNotify(`${modal.goal.name} is now a planned spend.`)
        setModal(null)
      } catch (caught) {
        onNotify(caught instanceof Error ? caught.message : 'Could not move this fund.')
      } finally {
        setBusy(false)
      }
      return
    }
    if (modal.mode === 'contribute') {
      const amount = Number(contribution)
      if (!Number.isFinite(amount) || amount <= 0) {
        onNotify('Enter a contribution above zero.')
        return
      }
      try {
        setBusy(true)
        await actions.contributeToGoal(modal.goal.id, amount, contributionFrom)
        onNotify(`${formatMoney(amount, currency)} moved into ${modal.goal.name}.`)
        setModal(null)
      } catch (caught) {
        onNotify(caught instanceof Error ? caught.message : 'Could not add the contribution.')
      } finally {
        setBusy(false)
      }
      return
    }
    if (!form.name.trim() || form.target_amount <= 0) {
      onNotify('Give the goal a name and a target above zero.')
      return
    }
    try {
      setBusy(true)
      const input: NewGoal = {
        ...form,
        name: form.name.trim(),
        target_date: form.target_date || null,
        current_amount: Math.max(0, form.current_amount),
        monthly_contribution: Math.max(0, form.monthly_contribution),
      }
      if (modal.mode === 'edit') await actions.updateGoal(modal.goal.id, input)
      else await actions.upsertGoal(input)
      onNotify(modal.mode === 'edit' ? 'Goal updated.' : 'Goal added.')
      setModal(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not save this goal.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(goal: Goal) {
    if (!window.confirm(`Remove "${goal.name}"?`)) return
    try {
      await actions.deleteGoal(goal.id)
      onNotify('Goal removed.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not remove this goal.')
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Plan</span>
          <h1>Savings funds</h1>
          <p>Keep true savings funds here. Use “Planned spend” on a fund that is really a future expense to move it into Planned spends.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Add fund</button>
        </div>
      </header>

      <div className="stat-strip">
        <div><span>Goals</span><strong>{summary.statuses.length}</strong></div>
        <div><span>Completed</span><strong className="positive">{completed}</strong></div>
        <div><span>Monthly contributions</span><strong>{formatMoney(summary.totalContribution, currency)}</strong></div>
        <div><span>Avg. forecast surplus</span><strong className={summary.forecastSurplus < 0 ? 'negative' : ''}>{formatMoney(summary.forecastSurplus, currency)}</strong></div>
      </div>

      {summary.overCommitted && (
        <div className="alert-strip alert-warn">
          Planned contributions ({formatMoney(summary.totalContribution, currency)}/mo) are above the average forecast surplus. Consider a smaller monthly amount.
        </div>
      )}

      {summary.statuses.length ? (
        <div className="goal-grid">
          {summary.statuses.map((status) => <GoalCard
            key={status.goal.id}
            status={status}
            currency={currency}
            onContribute={() => openContribute(status.goal)}
            onEdit={() => openEdit(status.goal)}
            onDelete={() => void remove(status.goal)}
            onMove={/emergency/i.test(status.goal.name) ? undefined : () => openMove(status.goal)}
          />)}
        </div>
      ) : (
        <section className="card">
          <div className="empty-state">
            <Target size={30} />
            <strong>No savings funds yet</strong>
            <span>Save for an emergency fund, a trip or a big purchase, and see the monthly amount you need.</span>
            <button className="btn btn-primary btn-small" onClick={openAdd}>Add fund</button>
          </div>
        </section>
      )}

      {modal && (
        <Modal
          title={modal.mode === 'contribute'
            ? `Contribute to ${modal.goal.name}`
            : modal.mode === 'move'
              ? `Move ${modal.goal.name} to Planned spends`
              : modal.mode === 'edit' ? 'Edit goal' : 'Add goal'}
          subtitle={modal.mode === 'contribute'
            ? `Currently ${formatMoney(modal.goal.current_amount, currency)} of ${formatMoney(modal.goal.target_amount, currency)}.`
            : modal.mode === 'move'
              ? 'Create a planned spend from the saved amount. The savings fund is removed.'
              : 'Monthly contributions appear in Cash flow, Month preview and the forecast as transfers into the fund.'}
          onClose={() => setModal(null)}
        >
          {modal.mode === 'move' ? (
            <div className="form-grid">
              <label className="field field-span-2">
                <span>Planned spend name</span>
                <input value={moveForm.name} onChange={(event) => setMoveForm({ ...moveForm, name: event.target.value })} />
              </label>
              <label className="field">
                <span>Category</span>
                <select value={moveForm.category} onChange={(event) => setMoveForm({ ...moveForm, category: event.target.value })}>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Amount ({currency})</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={moveForm.monthly_limit || ''}
                  onChange={(event) => setMoveForm({ ...moveForm, monthly_limit: Number(event.target.value) })}
                />
              </label>
              <label className="field">
                <span>Period</span>
                <select
                  value={moveForm.period ?? 'one_time'}
                  onChange={(event) => setMoveForm({ ...moveForm, period: event.target.value as BudgetPeriod })}
                >
                  <option value="one_time">One-off spend</option>
                  <option value="monthly">Monthly spend</option>
                  <option value="yearly">Yearly spend</option>
                </select>
              </label>
              {(moveForm.period ?? 'one_time') !== 'monthly' && (
                <label className="field">
                  <span>{moveForm.period === 'yearly' ? 'Start month' : 'Planned date'}</span>
                  <input
                    type={moveForm.period === 'yearly' ? 'month' : 'date'}
                    value={moveForm.start_date ?? ''}
                    onChange={(event) => setMoveForm({ ...moveForm, start_date: event.target.value })}
                  />
                </label>
              )}
              <p className="helper-text field-span-2">
                Use the full target as the planned spend; money already saved in the fund stays in your money trail.
              </p>
            </div>
          ) : modal.mode === 'contribute' ? (
            <div className="form-stack">
              <label className="field">
                <span>Amount ({currency})</span>
                <input type="number" min="0.01" step="0.01" value={contribution} onChange={(event) => setContribution(event.target.value)} />
              </label>
              <label className="field">
                <span>From account</span>
                <select value={contributionFrom} onChange={(event) => setContributionFrom(event.target.value)}>
                  {accounts
                    .filter((account) => account.id !== contributionDestination)
                    .map((account) => (
                      <option key={account.id} value={account.id}>{account.name}</option>
                    ))}
                </select>
              </label>
              <p className="helper-text">
                Recorded as one balanced transfer into {accountName(contributionDestination) || modal.goal.name}.
                Net worth stays the same; spendable cash goes down.
              </p>
            </div>
          ) : (
            <div className="form-grid">
              <label className="field field-span-2">
                <span>Name</span>
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Emergency fund" />
              </label>
              <label className="field">
                <span>Target amount ({currency})</span>
                <input type="number" min="1" step="0.01" value={form.target_amount || ''} onChange={(event) => setForm({ ...form, target_amount: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Already saved ({currency})</span>
                <input type="number" min="0" step="0.01" value={form.current_amount || ''} onChange={(event) => setForm({ ...form, current_amount: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Monthly contribution ({currency})</span>
                <input type="number" min="0" step="0.01" value={form.monthly_contribution || ''} onChange={(event) => setForm({ ...form, monthly_contribution: Number(event.target.value) })} />
              </label>
              <label className="field">
                <span>Target month</span>
                <input type="month" value={form.target_date ?? ''} onChange={(event) => setForm({ ...form, target_date: event.target.value || null })} />
              </label>
              <label className="field field-span-2">
                <span>Note (optional)</span>
                <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="What is this for?" />
              </label>
            </div>
          )}
          <div className="dialog-actions">
            <button className="btn btn-outline btn-small" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void save()}>
              {modal.mode === 'contribute' ? 'Add contribution' : modal.mode === 'move' ? 'Move to Planned spends' : modal.mode === 'edit' ? 'Save changes' : 'Add goal'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function GoalCard({ status, currency, onContribute, onEdit, onDelete, onMove }: {
  status: GoalStatus
  currency: string
  onContribute: () => void
  onEdit: () => void
  onDelete: () => void
  onMove?: () => void
}) {
  const { goal } = status
  const width = Math.max(0, Math.min(100, status.progress))
  return (
    <div className="card goal-card">
      <div className="card-head">
        <div>
          <h2>{goal.name}</h2>
          <p>{goal.target_date ? `Target: ${goal.target_date}` : 'No target date set'}</p>
        </div>
        <span className={`status-pill ${status.remaining <= 0 ? 'pill-teal' : status.onTrack ? 'pill-blue' : 'pill-red'}`}>
          {status.remaining <= 0 ? <CheckCircle2 size={13} /> : status.onTrack ? <Target size={13} /> : <CircleAlert size={13} />}
          {status.remaining <= 0 ? 'Complete' : status.onTrack ? 'On track' : 'Needs attention'}
        </span>
      </div>
      <div className="goal-progress-meta">
        <strong>{formatMoney(goal.current_amount, currency)}</strong>
        <span>of {formatMoney(goal.target_amount, currency)}</span>
        <b>{status.progress.toFixed(0)}%</b>
      </div>
      <div className="progress-track goal-track">
        <div className={`progress-fill ${status.onTrack ? '' : 'progress-over'}`} style={{ width: `${width}%` }} />
      </div>
      <div className="goal-details">
        <div><span>Remaining</span><strong>{formatMoney(status.remaining, currency)}</strong></div>
        <div><span>Months left</span><strong>{status.monthsRemaining}</strong></div>
        <div><span>Needed / mo</span><strong>{formatMoney(status.requiredMonthly, currency)}</strong></div>
        <div><span>Planned / mo</span><strong>{formatMoney(goal.monthly_contribution, currency)}</strong></div>
        <div><span>Projected gap</span><strong className={status.projectedGap > 0 ? 'negative' : 'positive'}>{status.projectedGap > 0 ? formatMoney(status.projectedGap, currency) : 'None'}</strong></div>
        <div><span>Pace</span><strong className={status.onTrack ? 'positive' : 'negative'}>{formatSigned(goal.monthly_contribution - status.requiredMonthly, currency)}</strong></div>
      </div>
      {goal.note && <p className="goal-note">{goal.note}</p>}
      <div className="dialog-actions goal-actions">
        <button className="btn btn-outline btn-small" onClick={onEdit}><Pencil size={14} /> Edit</button>
        <button className="icon-button danger" title="Delete goal" onClick={onDelete}><Trash2 size={16} /></button>
        {onMove && (
          <button className="btn btn-outline btn-small" title="Move to Planned spends" onClick={onMove}>
            <ArrowRight size={14} /> Planned spend
          </button>
        )}
        <button className="btn btn-primary btn-small" onClick={onContribute}>Add contribution</button>
      </div>
    </div>
  )
}
