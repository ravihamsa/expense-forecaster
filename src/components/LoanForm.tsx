import { useState, type FormEvent } from 'react'
import type { Loan, LoanDirection, LoanRepayment, MoneyAccount, NewLoan } from '../lib/types'
import { currencySymbol } from '../lib/format'
import { toDateInputValue } from '../lib/schedule'

interface Props {
  initial?: Loan | null
  defaultDirection?: LoanDirection
  currency?: string
  onSave: (input: NewLoan) => Promise<void>
  onCancel: () => void
}

export default function LoanForm({ initial, defaultDirection = 'borrowed', currency = 'INR', onSave, onCancel }: Props) {
  const [direction, setDirection] = useState<LoanDirection>(initial?.direction ?? defaultDirection)
  const repaymentType: LoanRepayment = initial?.repayment_type ?? (defaultDirection === 'lent' ? 'one_time' : 'emi')
  const [type, setType] = useState<LoanRepayment>(repaymentType)
  const [name, setName] = useState(initial?.name ?? '')
  const [account, setAccount] = useState<MoneyAccount>(initial?.account ?? 'bank')
  const [principal, setPrincipal] = useState(String(initial?.principal ?? ''))
  const [outstanding, setOutstanding] = useState(String(initial?.outstanding ?? ''))
  const [interestRate, setInterestRate] = useState(String(initial?.interest_rate ?? 0))
  const [emi, setEmi] = useState(String(initial?.emi ?? ''))
  const [startDate, setStartDate] = useState(initial?.start_date ?? toDateInputValue())
  const [tenureMonths, setTenureMonths] = useState(String(initial?.tenure_months ?? 0))
  const [dueDay, setDueDay] = useState(String(initial?.due_day ?? 1))
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function handlePrincipalChange(value: string) {
    const previous = Number(principal)
    const next = Number(value)
    setPrincipal(value)
    if (Number(outstanding) === previous || outstanding === '') setOutstanding(String(next))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const values = {
      principal: Number(principal),
      outstanding: Number(outstanding),
      interest_rate: Number(interestRate),
      emi: type === 'emi' ? Number(emi) : 0,
      tenure_months: type === 'emi' ? Number(tenureMonths) || 0 : 0,
      due_day: type === 'emi' ? Number(dueDay) : 1,
    }
    if (!name.trim()) return setError('Please give this loan a name.')
    if (!Number.isFinite(values.principal) || values.principal < 0) return setError('Enter a valid original loan amount.')
    if (!Number.isFinite(values.outstanding) || values.outstanding < 0) return setError('Enter a valid outstanding amount.')
    if (!Number.isFinite(values.interest_rate) || values.interest_rate < 0) return setError('Enter a valid interest rate.')
    if (type === 'emi' && (!Number.isFinite(values.emi) || values.emi <= 0)) return setError('Enter an EMI greater than zero, or choose a one-time loan.')
    if (type === 'emi' && (values.due_day < 1 || values.due_day > 31)) return setError('Due day must be between 1 and 31.')

    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        account,
        direction,
        repayment_type: type,
        principal: values.principal,
        outstanding: values.outstanding,
        interest_rate: values.interest_rate,
        emi: values.emi,
        start_date: startDate,
        tenure_months: values.tenure_months,
        due_day: values.due_day,
        due_date: type === 'one_time' ? dueDate || null : null,
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this loan.')
    } finally {
      setBusy(false)
    }
  }

  const symbol = currencySymbol(currency)

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div className="segmented" role="group" aria-label="Loan direction">
        <button type="button" className={direction === 'borrowed' ? 'segment-active' : ''} onClick={() => setDirection('borrowed')}>Loan taken</button>
        <button type="button" className={direction === 'lent' ? 'segment-active' : ''} onClick={() => { setDirection('lent'); setType('one_time'); setInterestRate('0') }}>Loan given</button>
      </div>
      <div className="segmented" role="group" aria-label="Repayment type">
        <button type="button" className={type === 'emi' ? 'segment-active' : ''} onClick={() => setType('emi')}>EMI loan</button>
        <button type="button" className={type === 'one_time' ? 'segment-active' : ''} onClick={() => setType('one_time')}>One-time / hand loan</button>
      </div>

      <div className="form-grid">
        <label className="field field-span-2">
          <span>{direction === 'lent' ? 'Who did you lend to?' : type === 'one_time' ? 'Who is this loan from?' : 'Loan name'}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={direction === 'lent' ? 'e.g. Friend, Relative, Colleague' : type === 'one_time' ? 'e.g. Friend, Parents, Hand loan' : 'e.g. Home loan, Car loan'}
            required
          />
        </label>
        <label className="field">
          <span>{direction === 'lent' ? 'Amount lent' : 'Original amount'} ({symbol})</span>
          <input type="number" min="0" step="0.01" value={principal} onChange={(e) => handlePrincipalChange(e.target.value)} placeholder="0" required />
        </label>
        <label className="field">
          <span>{direction === 'lent' ? 'Still owed to you' : 'Outstanding'} ({symbol})</span>
          <input type="number" min="0" step="0.01" value={outstanding} onChange={(e) => setOutstanding(e.target.value)} placeholder="0" required />
        </label>
        <label className="field">
          <span>Interest rate (% p.a.)</span>
          <input type="number" min="0" max="100" step="0.01" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} placeholder="0 for no interest" />
        </label>
        <label className="field">
          <span>Money account</span>
          <select value={account} onChange={(e) => setAccount(e.target.value as MoneyAccount)}>
            <option value="bank">Bank balance</option>
            <option value="cash">Cash in hand</option>
          </select>
        </label>

        {type === 'emi' ? (
          <>
            <label className="field">
              <span>Monthly EMI ({symbol})</span>
              <input type="number" min="1" step="0.01" value={emi} onChange={(e) => setEmi(e.target.value)} placeholder="0" required />
            </label>
            <label className="field">
              <span>Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </label>
            <label className="field">
              <span>Due day of month</span>
              <input type="number" min="1" max="31" value={dueDay} onChange={(e) => setDueDay(e.target.value)} required />
            </label>
            <label className="field field-span-2">
              <span>Tenure in months <span className="muted">(0 if unknown)</span></span>
              <input type="number" min="0" max="600" value={tenureMonths} onChange={(e) => setTenureMonths(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>{direction === 'lent' ? 'Lent on' : 'Borrowed on'}</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </label>
            <label className="field">
              <span>{direction === 'lent' ? 'Expected repayment date' : 'Planned repayment date'} <span className="muted">(optional)</span></span>
              <input type="date" min={startDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
            <div className="field-hint-card field-span-2">
              {direction === 'lent'
                ? 'No EMI is assumed. Set one expected repayment date, then record each partial repayment with its own date from the loan card — repayments show up as income in those months.'
                : 'No EMI is deducted. Set one planned repayment date, then record as many lump-sum payments on different dates as you like from the loan card. Interest can stay at 0%.'}
            </div>
          </>
        )}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add loan'}</button>
      </div>
    </form>
  )
}
