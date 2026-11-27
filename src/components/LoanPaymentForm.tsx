import { useState, type FormEvent } from 'react'
import type { Account, LoanDirection, MoneyAccount, NewLoanPayment } from '../lib/types'
import { currencySymbol } from '../lib/format'
import { toDateInputValue } from '../lib/schedule'

interface Props {
  loanId: string
  loanName: string
  direction?: LoanDirection
  accounts?: Account[]
  defaultAccount?: MoneyAccount
  currency?: string
  onSave: (input: NewLoanPayment) => Promise<void>
  onCancel: () => void
}

export default function LoanPaymentForm({
  loanId,
  loanName,
  direction = 'borrowed',
  accounts = [],
  defaultAccount,
  currency = 'INR',
  onSave,
  onCancel,
}: Props) {
  const isLent = direction === 'lent'
  const [amount, setAmount] = useState('')
  const [account, setAccount] = useState<MoneyAccount>(defaultAccount || 'bank')
  const [date, setDate] = useState(toDateInputValue())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) return setError('Enter an amount greater than zero.')
    if (!date) return setError('Choose a payment date.')
    setBusy(true)
    try {
      await onSave({ loan_id: loanId, amount: value, payment_date: date, account, note: note.trim() })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record this payment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <p className="helper-text">
        Recording {isLent ? 'a repayment received from' : 'a payment toward'} <strong>{loanName}</strong>.
        Payments dated today or earlier reduce the outstanding balance immediately. Later dates stay planned
        and appear as {isLent ? 'income' : 'an outflow'} in that month's forecast. You can record as many
        repayments as you like, each with its own date.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Amount ({currencySymbol(currency)})</span>
          <input type="number" min="1" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" required autoFocus />
        </label>
        <label className="field">
          <span>Payment date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span>{isLent ? 'Received into' : 'Paid from'}</span>
          <select value={account} onChange={(e) => setAccount(e.target.value as MoneyAccount)}>
            {(accounts.length ? accounts : [
              { id: 'bank', name: 'Bank balance' },
              { id: 'cash', name: 'Cash in hand' },
            ]).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <label className="field field-span-2">
          <span>Note <span className="muted">(optional)</span></span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Partial repayment" />
        </label>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : isLent ? 'Record repayment' : 'Record payment'}</button>
      </div>
    </form>
  )
}
