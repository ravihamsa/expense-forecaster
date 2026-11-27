import { useMemo, useState } from 'react'
import { CheckCircle2, CircleAlert, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import Modal from '../components/Modal'
import { buildGoalsSummary, type GoalStatus } from '../lib/goals'
import { formatMoney, formatSigned } from '../lib/format'
import type { AppActions, AppData, Goal, NewGoal, Simulation } from '../lib/types'

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

export default function Goals({ data, actions, simulation, currency, onNotify }: Props) {
  const [modal, setModal] = useState<ModalState | null>(null)
  const [form, setForm] = useState<NewGoal>(blankGoal())
  const [contribution, setContribution] = useState('')
  const [busy, setBusy] = useState(false)

  const summary = useMemo(() => buildGoalsSummary(data, simulation), [data, simulation])
  const completed = summary.statuses.filter((status) => status.remaining <= 0).length

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
    setModal({ mode: 'contribute', goal })
  }

  async function save() {
    if (!modal || busy) return
    if (modal.mode === 'contribute') {
      const amount = Number(contribution)
      if (!Number.isFinite(amount) || amount <= 0) {
        onNotify('Enter a contribution above zero.')
        return
      }
      try {
        setBusy(true)
        await actions.updateGoal(modal.goal.id, {
          current_amount: Math.max(0, modal.goal.current_amount + amount),
        })
        onNotify(`${formatMoney(amount, currency)} added to ${modal.goal.name}.`)
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
          <h1>Goals & sinking funds</h1>
          <p>Track progress toward a target and check whether your monthly contributions fit the forecast.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Add goal</button>
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
          />)}
        </div>
      ) : (
        <section className="card">
          <div className="empty-state">
            <Target size={30} />
            <strong>No goals yet</strong>
            <span>Save for an emergency fund, a trip or a big purchase, and see the monthly amount you need.</span>
            <button className="btn btn-primary btn-small" onClick={openAdd}>Add goal</button>
          </div>
        </section>
      )}

      {modal && (
        <Modal
          title={modal.mode === 'contribute' ? `Contribute to ${modal.goal.name}` : modal.mode === 'edit' ? 'Edit goal' : 'Add goal'}
          subtitle={modal.mode === 'contribute'
            ? `Currently ${formatMoney(modal.goal.current_amount, currency)} of ${formatMoney(modal.goal.target_amount, currency)}.`
            : 'Goals are tracked alongside the forecast; contributions do not change your projected balance.'}
          onClose={() => setModal(null)}
        >
          {modal.mode === 'contribute' ? (
            <div className="form-stack">
              <label className="field">
                <span>Amount ({currency})</span>
                <input type="number" min="0.01" step="0.01" value={contribution} onChange={(event) => setContribution(event.target.value)} />
              </label>
              <p className="helper-text">Use “Add goal contribution” to record money you have actually set aside.</p>
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
              {modal.mode === 'contribute' ? 'Add contribution' : modal.mode === 'edit' ? 'Save changes' : 'Add goal'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function GoalCard({ status, currency, onContribute, onEdit, onDelete }: {
  status: GoalStatus
  currency: string
  onContribute: () => void
  onEdit: () => void
  onDelete: () => void
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
        <button className="btn btn-primary btn-small" onClick={onContribute}>Add contribution</button>
      </div>
    </div>
  )
}
