import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  GripVertical,
  RotateCcw,
  Scissors,
  Trash2,
  Undo2,
} from 'lucide-react'
import CategoryBadge from '../components/CategoryBadge'
import Modal from '../components/Modal'
import { actualFromEvent } from '../lib/actuals'
import { formatMoney, formatSigned } from '../lib/format'
import { toDateInputValue } from '../lib/schedule'
import type { AppActions, AppData, FlowEvent, MonthProjection } from '../lib/types'

interface Props {
  data: AppData
  months: MonthProjection[]
  actions: AppActions
  onNotify: (message: string) => void
}

type Mode = 'move' | 'duplicate' | 'split' | 'actual' | 'delete'
type DeleteScope = 'date' | 'all'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MODES: { value: Mode; label: string }[] = [
  { value: 'move', label: 'Move' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'split', label: 'Split' },
  { value: 'actual', label: 'Actual' },
  { value: 'delete', label: 'Delete' },
]

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function longDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

function round(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

export default function CalendarPage({ data, months, actions, onNotify }: Props) {
  const currency = data.profile.currency || 'INR'
  const [selectedKey, setSelectedKey] = useState(months[0]?.key ?? '')
  const [active, setActive] = useState<FlowEvent | null>(null)
  const [mode, setMode] = useState<Mode>('move')
  const [draftDate, setDraftDate] = useState('')
  const [splitAmount, setSplitAmount] = useState('')
  const [actualAmount, setActualAmount] = useState('')
  const [actualNote, setActualNote] = useState('')
  const [deleteScope, setDeleteScope] = useState<DeleteScope>('date')
  const [busy, setBusy] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [hoverDate, setHoverDate] = useState<string | null>(null)

  useEffect(() => {
    if (!months.some((month) => month.key === selectedKey)) setSelectedKey(months[0]?.key ?? '')
  }, [months, selectedKey])

  const index = Math.max(0, months.findIndex((month) => month.key === selectedKey))
  const month = months[index]
  if (!month) return null

  const monthByKey = useMemo(() => new Map(months.map((item) => [item.key, item])), [months])
  const skippedEvents = useMemo(() => {
    return (data.cashFlowSkips ?? []).flatMap((skip) => {
      const flow = data.cashFlows.find((item) => item.id === skip.cash_flow_id)
      if (!flow) return []
      const move = (data.cashFlowMoves ?? []).find(
        (item) => item.cash_flow_id === skip.cash_flow_id && item.from_date === skip.date,
      )
      const date = move?.to_date ?? skip.date
      const override = (data.cashFlowOverrides ?? []).find(
        (item) => item.cash_flow_id === skip.cash_flow_id && item.month === date.slice(0, 7),
      )
      const event: FlowEvent = {
        id: `skip-${skip.id}`,
        name: flow.name,
        kind: flow.kind,
        amount: override?.amount ?? flow.amount,
        category: flow.category,
        source: 'cash_flow',
        cashFlowId: flow.id,
        date,
        sourceMonth: date.slice(0, 7),
        originalDate: skip.date,
        skipId: skip.id,
        skipped: true,
        canMove: false,
      }
      return [event]
    })
  }, [data.cashFlowSkips, data.cashFlows, data.cashFlowMoves, data.cashFlowOverrides])
  const eventsByDate = useMemo(() => {
    const map = new Map<string, FlowEvent[]>()
    months.forEach((item) => item.events.forEach((event) => {
      const list = map.get(event.date) ?? []
      list.push(event)
      map.set(event.date, list)
    }))
    skippedEvents.forEach((event) => {
      const list = map.get(event.date) ?? []
      list.push(event)
      map.set(event.date, list)
    })
    map.forEach((list) => list.sort(
      (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'income' ? -1 : 1),
    ))
    return map
  }, [months, skippedEvents])
  const eventsById = useMemo(() => {
    const map = new Map<string, FlowEvent>()
    months.forEach((item) => item.events.forEach((event) => map.set(event.id, event)))
    return map
  }, [months])

  const firstMonth = months[0]
  const lastMonth = months[months.length - 1]
  const minDate = `${firstMonth.year}-${String(firstMonth.monthIndex + 1).padStart(2, '0')}-01`
  const maxDate = dateKey(new Date(lastMonth.year, lastMonth.monthIndex + 1, 0))
  const today = toDateInputValue()

  const cells = useMemo(() => {
    const offset = (new Date(month.year, month.monthIndex, 1).getDay() + 6) % 7
    return Array.from({ length: 42 }, (_, i) => new Date(month.year, month.monthIndex, i - offset + 1))
  }, [month.year, month.monthIndex])

  const income = month.income + month.loanInflows
  const outgoing = month.expenses + month.loanPayments + month.extraPayment

  function moveMonth(delta: number) {
    const next = months[index + delta]
    if (next) setSelectedKey(next.key)
  }

  function openAction(event: FlowEvent) {
    if (event.skipped) return
    // Budgets are planned spends, not cash flows: the only calendar action is
    // recording the real amount against that occurrence.
    if (event.source === 'budget') {
      setActive(event)
      setMode('actual')
      setDraftDate(event.date)
      setActualAmount(String(round(event.actualAmount ?? event.amount)))
      setActualNote(data.actuals.find((item) => item.event_key === event.id)?.note ?? '')
      setDeleteScope('date')
      setDraggingId(null)
      return
    }
    if (!event.canMove) return
    setActive(event)
    setMode('move')
    setDraftDate(event.date)
    setSplitAmount(String(round(event.amount / 2)))
    setActualAmount(String(round(event.actualAmount ?? event.amount)))
    setActualNote(data.actuals.find((item) => item.event_key === event.id)?.note ?? '')
    setDeleteScope('date')
    setDraggingId(null)
  }

  function inForecast(value: string): boolean {
    return Boolean(value) && value >= minDate && value <= maxDate
  }

  async function moveEvent(event: FlowEvent, targetDate: string) {
    if (!inForecast(targetDate)) {
      onNotify('Choose a date inside the forecast window.')
      return
    }
    if (event.source === 'profile') {
      const sourceMonth = event.sourceMonth ?? event.date.slice(0, 7)
      if (targetDate.slice(0, 7) !== sourceMonth) {
        onNotify('Expected income can move within its own month. Edit another month to change its amount.')
        return
      }
      const entry = data.monthlyIncomes.find((item) => item.month === sourceMonth)
      await actions.upsertMonthlyIncome({
        month: sourceMonth,
        amount: event.amount,
        day: Number(targetDate.slice(-2)) || 1,
        note: entry?.note ?? '',
      })
      onNotify(`Income moved to ${longDate(targetDate)}.`)
      return
    }
    if (!event.cashFlowId) return
    const originalDate = event.originalDate ?? event.date
    if (event.moveId && targetDate === originalDate) {
      await actions.deleteCashFlowMove(event.moveId)
      onNotify('Original date restored.')
      return
    }
    if (targetDate === originalDate) return
    await actions.upsertCashFlowMove({
      cash_flow_id: event.cashFlowId,
      from_date: originalDate,
      to_date: targetDate,
    })
    onNotify(`Moved to ${longDate(targetDate)}.`)
  }

  async function duplicateEvent(event: FlowEvent, targetDate: string) {
    if (!inForecast(targetDate)) {
      onNotify('Choose a date inside the forecast window.')
      return
    }
    const flow = event.cashFlowId ? data.cashFlows.find((item) => item.id === event.cashFlowId) : undefined
    await actions.addCashFlow({
      kind: event.kind,
      name: `${event.name} (copy)`,
      amount: round(event.amount),
      category: event.category || (event.kind === 'income' ? 'Income' : 'Other'),
      account: flow?.account ?? 'bank',
      recurrence: 'one_time',
      interval_count: 1,
      start_date: targetDate,
      end_date: null,
      note: 'Duplicated from the calendar',
    })
    onNotify(`Duplicate added on ${longDate(targetDate)}.`)
  }

  async function splitEvent(event: FlowEvent, targetDate: string, amount: number) {
    if (!inForecast(targetDate)) {
      onNotify('Choose a date inside the forecast window.')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount >= event.amount) {
      onNotify(`Split amount must be greater than zero and less than ${formatMoney(event.amount, currency)}.`)
      return
    }
    const remaining = round(event.amount - amount)
    if (event.source === 'profile') {
      const sourceMonth = event.sourceMonth ?? event.date.slice(0, 7)
      const entry = data.monthlyIncomes.find((item) => item.month === sourceMonth)
      await actions.upsertMonthlyIncome({
        month: sourceMonth,
        amount: remaining,
        day: entry?.day ?? (Number(event.date.slice(-2)) || 1),
        note: entry?.note ?? '',
      })
    } else if (event.cashFlowId) {
      const sourceMonth = event.sourceMonth ?? event.date.slice(0, 7)
      await actions.upsertCashFlowOverride({
        cash_flow_id: event.cashFlowId,
        month: sourceMonth,
        amount: remaining,
      })
    } else {
      return
    }

    const flow = event.cashFlowId ? data.cashFlows.find((item) => item.id === event.cashFlowId) : undefined
    await actions.addCashFlow({
      kind: event.kind,
      name: `${event.name} (split)`,
      amount: round(amount),
      category: event.category || (event.kind === 'income' ? 'Income' : 'Other'),
      account: flow?.account ?? 'bank',
      recurrence: 'one_time',
      interval_count: 1,
      start_date: targetDate,
      end_date: null,
      note: `Split from ${longDate(event.date)}`,
    })
    onNotify(`${formatMoney(amount, currency)} split to ${longDate(targetDate)}.`)
  }

  async function recordActual(event: FlowEvent) {
    const amount = Number(actualAmount)
    if (event.date > toDateInputValue()) {
      onNotify('Actual amounts can only be recorded on or after the planned date.')
      return
    }
    if (!Number.isFinite(amount) || amount < 0) {
      onNotify('Enter a valid actual amount.')
      return
    }
    await actions.upsertActual({
      ...actualFromEvent(event, actualNote.trim()),
      amount: round(amount),
    })
    onNotify('Actual amount recorded.')
  }

  async function deleteEvent(event: FlowEvent, scope: DeleteScope) {
    if (event.source === 'profile') {
      const sourceMonth = event.sourceMonth ?? event.date.slice(0, 7)
      const entry = data.monthlyIncomes.find((item) => item.month === sourceMonth)
      if (scope === 'date') {
        await actions.upsertMonthlyIncome({
          month: sourceMonth,
          amount: 0,
          day: entry?.day ?? (Number(event.date.slice(-2)) || 1),
          note: entry?.note ?? '',
        })
        onNotify('Income removed for this month.')
        return
      }
      const fromIndex = months.findIndex((item) => item.key === sourceMonth)
      for (let i = Math.max(0, fromIndex); i < months.length; i += 1) {
        const key = months[i].key
        const existing = data.monthlyIncomes.find((item) => item.month === key)
        await actions.upsertMonthlyIncome({
          month: key,
          amount: 0,
          day: existing?.day ?? 1,
          note: existing?.note ?? '',
        })
      }
      onNotify('Income removed from this month onward.')
      return
    }
    if (!event.cashFlowId) return
    if (scope === 'all') {
      await actions.deleteCashFlow(event.cashFlowId)
      onNotify('Entry deleted from every month.')
      return
    }
    await actions.upsertCashFlowSkip({
      cash_flow_id: event.cashFlowId,
      date: event.originalDate ?? event.date,
    })
    onNotify('Entry skipped on this date only.')
  }

  async function restoreSkip(id: string) {
    try {
      setBusy(true)
      await actions.deleteCashFlowSkip(id)
      onNotify('Skipped entry restored.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not restore this entry.')
    } finally {
      setBusy(false)
    }
  }

  async function resetEvent(event: FlowEvent) {
    try {
      setBusy(true)
      if (event.moveId) {
        await actions.deleteCashFlowMove(event.moveId)
      } else if (event.source === 'profile') {
        const sourceMonth = event.sourceMonth ?? event.date.slice(0, 7)
        const entry = data.monthlyIncomes.find((item) => item.month === sourceMonth)
        if (entry) {
          await actions.upsertMonthlyIncome({ ...entry, day: 1 })
        }
      }
      onNotify('Original schedule restored.')
      setActive(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not restore this entry.')
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!active || busy) return
    try {
      setBusy(true)
      if (mode === 'move') await moveEvent(active, draftDate)
      else if (mode === 'duplicate') await duplicateEvent(active, draftDate)
      else if (mode === 'split') await splitEvent(active, draftDate, Number(splitAmount))
      else if (mode === 'actual') await recordActual(active)
      else await deleteEvent(active, deleteScope)
      setActive(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not update this entry.')
    } finally {
      setBusy(false)
    }
  }

  function handleDrop(date: string, droppedId?: string) {
    const id = droppedId || draggingId
    setHoverDate(null)
    setDraggingId(null)
    if (!id) return
    const event = eventsById.get(id)
    if (event?.canMove) void moveEvent(event, date)
  }

  const activeMonth = active ? monthByKey.get(active.sourceMonth ?? active.date.slice(0, 7)) : undefined
  const modalMin = active?.source === 'profile' && activeMonth
    ? `${activeMonth.year}-${String(activeMonth.monthIndex + 1).padStart(2, '0')}-01`
    : minDate
  const modalMax = active?.source === 'profile' && activeMonth
    ? dateKey(new Date(activeMonth.year, activeMonth.monthIndex + 1, 0))
    : maxDate
  const isIncomePlan = active?.source === 'profile'
  const availableModes = active?.source === 'budget'
    ? MODES.filter((option) => option.value === 'actual')
    : MODES
  const needsDate = mode === 'move' || mode === 'duplicate' || mode === 'split'
  const submitDisabled = busy || (needsDate && !draftDate)

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Plan & track</span>
          <h1>Calendar</h1>
          <p>Budgeted spends appear here and can be marked with an actual amount. Income entries can also be moved, duplicated or split.</p>
        </div>
        <span className="status-pill pill-blue"><GripVertical size={14} /> Drag to reschedule</span>
      </header>

      <div className="stat-strip">
        <div><span>Money in</span><strong className="positive">{formatMoney(income, currency)}</strong></div>
        <div><span>Money out</span><strong className="negative">−{formatMoney(outgoing, currency)}</strong></div>
        <div><span>Net</span><strong className={month.net >= 0 ? 'positive' : 'negative'}>{formatSigned(month.net, currency)}</strong></div>
        <div><span>Closing balance</span><strong>{formatMoney(month.closingBalance, currency)}</strong></div>
      </div>

      <section className="card calendar-card">
        <div className="card-head">
          <div>
            <h2>{month.label}</h2>
            <p>Moving an entry changes this month’s net and the balance carried into later months.</p>
          </div>
          <div className="preview-controls">
            <div className="month-stepper">
              <button className="icon-button" aria-label="Previous month" title="Previous month" onClick={() => moveMonth(-1)} disabled={index <= 0}><ChevronLeft size={15} /></button>
              <button className="icon-button" aria-label="Next month" title="Next month" onClick={() => moveMonth(1)} disabled={index >= months.length - 1}><ChevronRight size={15} /></button>
            </div>
            <label className="month-picker">
              <CalendarDays size={15} />
              <select aria-label="Calendar month" value={month.key} onChange={(event) => setSelectedKey(event.target.value)}>
                {months.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="calendar-weekdays">
          {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
        </div>

        <div className="calendar-grid">
          {cells.map((cell) => {
            const key = dateKey(cell)
            const dayEvents = eventsByDate.get(key) ?? []
            const inMonth = cell.getMonth() === month.monthIndex && cell.getFullYear() === month.year
            const inRange = inForecast(key)
            const dayIncome = dayEvents.filter((event) => !event.skipped && event.kind === 'income').reduce((sum, event) => sum + event.amount, 0)
            const dayExpense = dayEvents.filter((event) => !event.skipped && event.kind === 'expense').reduce((sum, event) => sum + event.amount, 0)
            return (
              <div
                key={key}
                data-date={key}
                className={`calendar-day ${inMonth ? '' : 'calendar-day-muted'} ${key === today ? 'calendar-day-today' : ''} ${hoverDate === key ? 'calendar-day-hover' : ''} ${inRange ? '' : 'calendar-day-disabled'}`}
                onDragOver={(event) => { if (draggingId && inRange) event.preventDefault() }}
                onDragEnter={() => { if (draggingId && inRange) setHoverDate(key) }}
                onDragLeave={() => setHoverDate((current) => (current === key ? null : current))}
                onDrop={(event) => {
                  event.preventDefault()
                  if (inRange) handleDrop(key, event.dataTransfer.getData('text/plain'))
                }}
              >
                <div className="calendar-day-head">
                  <span>{cell.getDate()}</span>
                  {key === today && <span className="calendar-today-label">Today</span>}
                </div>
                <div className="calendar-cell-events">
                  {dayEvents.slice(0, 3).map((event) => {
                    if (event.skipped) {
                      return (
                        <div key={event.id} className="calendar-chip calendar-chip-static calendar-chip-skipped" title={`${event.name} is skipped on ${longDate(event.date)}`}>
                          <span className="calendar-chip-name">{event.name}</span>
                          <small>Skipped</small>
                          <button
                            type="button"
                            className="chip-restore"
                            disabled={busy}
                            title="Restore this date"
                            aria-label={`Restore ${event.name}`}
                            onClick={() => event.skipId && void restoreSkip(event.skipId)}
                          >
                            <Undo2 size={12} />
                          </button>
                        </div>
                      )
                    }
                    const content = (
                      <>
                        <span className="calendar-chip-label">
                          <CategoryBadge
                            name={event.category || (event.kind === 'income' ? 'Income' : 'Other')}
                            small
                            size={12}
                          />
                          <span className="calendar-chip-name">{event.name}</span>
                        </span>
                        <b>{event.kind === 'income' ? '+' : '−'}{formatMoney(event.amount, currency)}</b>
                        {event.actualAmount !== undefined && (
                          <span className="calendar-actual-dot" title={`Actual: ${formatMoney(event.actualAmount, currency)}`}>
                            <CheckCircle2 size={12} />
                          </span>
                        )}
                        {event.moved && <span className="calendar-moved-dot" title="Moved from its original date" />}
                      </>
                    )
                    const canOpen = Boolean(event.canMove) || event.source === 'budget'
                    return canOpen ? (
                      <button
                        key={event.id}
                        data-event-id={event.id}
                        type="button"
                        className={`calendar-chip calendar-chip-${event.kind}`}
                        draggable={Boolean(event.canMove)}
                        onDragStart={(drag) => {
                          if (!event.canMove) return
                          drag.dataTransfer.effectAllowed = 'move'
                          drag.dataTransfer.setData('text/plain', event.id)
                          setDraggingId(event.id)
                        }}
                        onDragEnd={() => { setDraggingId(null); setHoverDate(null) }}
                        onClick={() => openAction(event)}
                        title={`${event.name} on ${longDate(event.date)} · ${event.source === 'budget' ? 'click to record an actual' : 'click for options'}`}
                      >
                        {content}
                      </button>
                    ) : (
                      <div key={event.id} className={`calendar-chip calendar-chip-static calendar-chip-${event.kind}`} title={`${event.name} · this entry is read-only here`}>
                        {content}
                      </div>
                    )
                  })}
                  {dayEvents.length > 3 && <span className="calendar-more">+{dayEvents.length - 3} more</span>}
                </div>
                {dayEvents.length > 0 && (
                  <div className="calendar-day-totals">
                    {dayIncome > 0 && <span className="positive">+{formatMoney(dayIncome, currency)}</span>}
                    {dayExpense > 0 && <span className="negative">−{formatMoney(dayExpense, currency)}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="calendar-legend">
          <span><i className="legend-dot legend-income" /> Income</span>
          <span><i className="legend-dot legend-expense" /> Expense</span>
          <span><i className="legend-dot legend-loan" /> Loan (read-only)</span>
          <span><CheckCircle2 size={12} /> Actual recorded</span>
          <span>Click a budget to record an actual · drag income to reschedule</span>
        </div>

        {skippedEvents.length > 0 && (
          <div className="calendar-skipped-list">
            <strong>Skipped on a single date</strong>
            <div className="calendar-skipped-chips">
              {skippedEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="skipped-chip"
                  disabled={busy}
                  onClick={() => event.skipId && void restoreSkip(event.skipId)}
                  title="Restore this occurrence"
                >
                  <Undo2 size={13} />
                  {event.name} · {longDate(event.date)}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {active && (
        <Modal
          title={`${mode === 'delete' ? 'Delete' : mode === 'actual' ? 'Record actual for' : 'Reschedule'} ${active.name}`}
          subtitle={`${longDate(active.date)} · ${formatMoney(active.amount, currency)} · ${active.kind}`}
          onClose={() => setActive(null)}
        >
          <div className="calendar-dialog">
            <div className="segmented calendar-modes" role="group" aria-label="Calendar action">
              {availableModes.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={mode === option.value ? 'segment-active' : ''}
                  onClick={() => setMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {needsDate && (
              <label className="field">
                <span>{mode === 'move' ? 'Move to date' : mode === 'duplicate' ? 'Duplicate on date' : 'Split off to date'}</span>
                <input
                  type="date"
                  min={modalMin}
                  max={modalMax}
                  value={draftDate}
                  onChange={(event) => setDraftDate(event.target.value)}
                />
              </label>
            )}

            {mode === 'split' && (
              <label className="field">
                <span>Amount to move ({currency})</span>
                <input
                  type="number"
                  min="0.01"
                  max={round(active.amount - 0.01)}
                  step="0.01"
                  value={splitAmount}
                  onChange={(event) => setSplitAmount(event.target.value)}
                />
                <small>{formatMoney(round(active.amount - Number(splitAmount || 0)), currency)} stays on the original entry.</small>
              </label>
            )}

            {mode === 'actual' && (
              <>
                <label className="field">
                  <span>Actual amount ({currency})</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={actualAmount}
                    onChange={(event) => setActualAmount(event.target.value)}
                  />
                  <small>Leave the planned amount unchanged; this records what really happened.</small>
                </label>
                <label className="field">
                  <span>Note (optional)</span>
                  <input value={actualNote} onChange={(event) => setActualNote(event.target.value)} placeholder="e.g. bank statement" />
                </label>
              </>
            )}

            {mode === 'delete' && (
              <div className="delete-scope-group" role="radiogroup" aria-label="Delete scope">
                <button
                  type="button"
                  role="radio"
                  aria-checked={deleteScope === 'date'}
                  className={`delete-scope ${deleteScope === 'date' ? 'delete-scope-active' : ''}`}
                  onClick={() => setDeleteScope('date')}
                >
                  <strong>{isIncomePlan ? 'Just this month' : 'Just this date'}</strong>
                  <span>
                    {isIncomePlan
                      ? 'Remove this month’s expected income and leave other months untouched.'
                      : 'Skip only this occurrence. The recurring entry stays in other months and can be restored.'}
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={deleteScope === 'all'}
                  className={`delete-scope ${deleteScope === 'all' ? 'delete-scope-active' : ''}`}
                  onClick={() => setDeleteScope('all')}
                >
                  <strong>{isIncomePlan ? 'From this month onward' : 'Whole entry'}</strong>
                  <span>
                    {isIncomePlan
                      ? 'Remove this income plan for this month and every later month in the forecast.'
                      : 'Delete the underlying income or expense entirely, including all its future occurrences.'}
                  </span>
                </button>
              </div>
            )}

            <p className="helper-text">
              {mode === 'move'
                ? 'The original entry changes date. Its amount and account stay the same.'
                : mode === 'duplicate'
                  ? 'A separate one-time entry is added; the original stays where it is.'
                  : mode === 'split'
                    ? 'Part of this entry becomes a one-time item on the new date; the remainder stays on the original entry.'
                    : mode === 'actual'
                      ? 'This replaces the budgeted amount for this occurrence and drives rollover and the money trail.'
                      : deleteScope === 'date'
                        ? 'A skipped occurrence can be restored from the calendar at any time.'
                        : 'This cannot be undone. Use “just this date” if you only want one occurrence removed.'}
            </p>

            <div className="dialog-actions">
              {(active.moveId || active.moved) && mode !== 'delete' && (
                <button className="btn btn-outline btn-small" disabled={busy} onClick={() => void resetEvent(active)}>
                  <RotateCcw size={14} /> Restore
                </button>
              )}
              <button
                className={`btn btn-small ${mode === 'delete' ? 'btn-danger' : 'btn-primary'}`}
                disabled={submitDisabled}
                onClick={() => void submit()}
              >
                {mode === 'move' ? <CalendarDays size={14} />
                  : mode === 'duplicate' ? <Copy size={14} />
                    : mode === 'split' ? <Scissors size={14} />
                      : mode === 'actual' ? <CheckCircle2 size={14} />
                        : <Trash2 size={14} />}
                {mode === 'move' ? ' Move here'
                  : mode === 'duplicate' ? ' Duplicate here'
                    : mode === 'split' ? ' Split here'
                      : mode === 'actual' ? ' Save actual'
                        : deleteScope === 'date' ? ' Skip this date' : ' Delete entry'}
                {mode !== 'delete' && <Check size={13} />}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
