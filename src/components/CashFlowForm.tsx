import { useState, type FormEvent } from 'react'
import type { CashFlow, FlowKind, MoneyAccount, NewCashFlow, Recurrence } from '../lib/types'
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../lib/categories'
import { currencySymbol } from '../lib/format'
import { toDateInputValue } from '../lib/schedule'

const RECURRENCES: { value: Recurrence; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'one_time', label: 'One-time / ad-hoc' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'every_n_months', label: 'Every N months' },
  { value: 'every_n_years', label: 'Every N years' },
]

interface Props {
  initial?: CashFlow | null
  defaultKind?: FlowKind
  currency?: string
  onSave: (input: NewCashFlow) => Promise<void>
  onCancel: () => void
}

export default function CashFlowForm({ initial, defaultKind = 'expense', currency = 'INR', onSave, onCancel }: Props) {
  const [kind, setKind] = useState<FlowKind>(initial?.kind ?? defaultKind)
  const [name, setName] = useState(initial?.name ?? '')
  const [amount, setAmount] = useState(String(initial?.amount ?? ''))
  const [category, setCategory] = useState(initial?.category ?? (defaultKind === 'income' ? 'Salary' : 'Housing'))
  const [customCategory, setCustomCategory] = useState(() => {
    const initialCategory = initial?.category ?? ''
    return initialCategory !== ''
      && !(initial?.kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).includes(initialCategory)
  })
  const [account, setAccount] = useState<MoneyAccount>(initial?.account ?? 'bank')
  const [recurrence, setRecurrence] = useState<Recurrence>(initial?.recurrence ?? 'monthly')
  const [intervalCount, setIntervalCount] = useState(String(initial?.interval_count ?? 3))
  const [startDate, setStartDate] = useState(initial?.start_date ?? toDateInputValue())
  const [endDate, setEndDate] = useState(initial?.end_date ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const categories = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const needsInterval = recurrence === 'every_n_months' || recurrence === 'every_n_years'
  const categoryValue = customCategory ? '__custom__' : category

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const numericAmount = Number(amount)
    if (!name.trim()) return setError('Please enter a name.')
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setError('Enter an amount greater than zero.')
    if (!category.trim()) return setError('Please choose or enter a category.')
    if (needsInterval && (!Number(intervalCount) || Number(intervalCount) < 1)) return setError('Enter a valid interval.')

    setBusy(true)
    try {
      await onSave({
        kind,
        name: name.trim(),
        amount: numericAmount,
        category: category.trim(),
        account,
        recurrence,
        interval_count: needsInterval ? Math.floor(Number(intervalCount)) : 1,
        start_date: startDate,
        end_date: endDate || null,
        note: note.trim(),
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this entry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div className="segmented" role="group" aria-label="Type">
        <button type="button" className={kind === 'expense' ? 'segment-active' : ''} onClick={() => { setKind('expense'); setCategory('Housing'); setCustomCategory(false) }}>Expense</button>
        <button type="button" className={kind === 'income' ? 'segment-active' : ''} onClick={() => { setKind('income'); setCategory('Salary'); setCustomCategory(false) }}>Income</button>
      </div>

      <div className="form-grid">
        <label className="field field-span-2">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'income' ? 'e.g. Freelance project' : 'e.g. Rent, Netflix, Car service'} required />
        </label>
        <label className="field">
          <span>Amount ({currencySymbol(currency)})</span>
          <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" required />
        </label>
        <label className="field">
          <span>Category</span>
          <select
            value={categoryValue}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                setCustomCategory(true)
                setCategory(categories.includes(category) ? '' : category)
              } else {
                setCustomCategory(false)
                setCategory(e.target.value)
              }
            }}
          >
            {categories.map((option) => <option key={option} value={option}>{option}</option>)}
            <option value="__custom__">Custom category…</option>
          </select>
        </label>
        {customCategory && (
          <label className="field field-span-2">
            <span>Custom category name</span>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Pet care" required />
          </label>
        )}
        <label className="field">
          <span>Money account</span>
          <select value={account} onChange={(e) => setAccount(e.target.value as MoneyAccount)}>
            <option value="bank">Bank balance</option>
            <option value="cash">Cash in hand</option>
          </select>
        </label>
        <label className="field">
          <span>Schedule</span>
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            {RECURRENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {needsInterval ? (
          <label className="field">
            <span>Repeat every</span>
            <input type="number" min="1" max="120" value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} required />
          </label>
        ) : (
          <div className="field-hint-card">
            {recurrence === 'one_time'
              ? 'A single entry on the date below — perfect for ad-hoc income or surprise bills.'
              : recurrence === 'monthly'
                ? 'Repeats on the same day of every month from the start date.'
                : 'Repeats on the same month and day each year.'}
            {' '}Fine-tune individual months later in the dashboard's month preview.
          </div>
        )}
        <label className="field">
          <span>Start date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>End date <span className="muted">(optional)</span></span>
          <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label className="field field-span-2">
          <span>Note <span className="muted">(optional)</span></span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth remembering…" />
        </label>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add entry'}</button>
      </div>
    </form>
  )
}
