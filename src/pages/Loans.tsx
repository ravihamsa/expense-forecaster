import { useState } from 'react'
import {
  CalendarDays,
  HandCoins,
  Landmark,
  Pencil,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react'
import Modal from '../components/Modal'
import LoanForm from '../components/LoanForm'
import LoanPaymentForm from '../components/LoanPaymentForm'
import { formatDate, formatMoney, formatPercent } from '../lib/format'
import { summarizeLoans } from '../lib/loans'
import { loanPayoffMonths, loanTotalInterest } from '../lib/projections'
import type {
  AppActions,
  AppData,
  Loan,
  LoanDirection,
  NewLoan,
  NewLoanPayment,
} from '../lib/types'

interface Props {
  data: AppData
  actions: AppActions
  onNotify: (message: string) => void
  onPayFaster: (loanId: string) => void
}

export default function Loans({ data, actions, onNotify, onPayFaster }: Props) {
  const currency = data.profile.currency || 'INR'
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; loan?: Loan; direction?: LoanDirection } | null>(null)
  const [paymentModal, setPaymentModal] = useState<Loan | null>(null)

  const borrowed = data.loans.filter((loan) => loan.direction === 'borrowed')
  const lent = data.loans.filter((loan) => loan.direction === 'lent')
  const activeBorrowed = borrowed.filter((loan) => loan.outstanding > 0)
  const activeLent = lent.filter((loan) => loan.outstanding > 0)
  const loanTotals = summarizeLoans(data.loans)

  const totalOwed = loanTotals.owed
  const totalReceivable = loanTotals.receivable
  const monthlyEmi = loanTotals.monthlyEmi
  const totalInterest = activeBorrowed.reduce(
    (sum, loan) => sum + loanTotalInterest(loan, 0, data.loanPayments),
    0,
  )
  const handLoans = [...activeBorrowed, ...activeLent].filter((loan) => loan.repayment_type === 'one_time')

  async function handleSave(input: NewLoan) {
    try {
      if (modal?.mode === 'edit' && modal.loan) {
        await actions.updateLoan(modal.loan.id, input)
        onNotify('Loan updated.')
      } else {
        await actions.addLoan(input)
        onNotify(input.direction === 'lent' ? 'Loan given added.' : 'Loan added to your plan.')
      }
      setModal(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not save this loan.')
    }
  }

  async function handlePaymentSave(input: NewLoanPayment) {
    try {
      await actions.addLoanPayment(input)
      onNotify(paymentModal?.direction === 'lent' ? 'Repayment recorded as income.' : 'Payment recorded.')
      setPaymentModal(null)
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not record this payment.')
    }
  }

  async function handleDelete(loan: Loan) {
    if (!window.confirm(`Remove "${loan.name}" from your loans?`)) return
    try {
      await actions.deleteLoan(loan.id)
      onNotify('Loan removed.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not remove this loan.')
    }
  }

  async function handleDeletePayment(id: string) {
    if (!window.confirm('Remove this recorded payment?')) return
    try {
      await actions.deleteLoanPayment(id)
      onNotify('Payment removed.')
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : 'Could not remove this payment.')
    }
  }

  function renderLoanCard(loan: Loan) {
    const isLent = loan.direction === 'lent'
    const isOneTime = loan.repayment_type === 'one_time'
    const paidPercent = loan.principal > 0
      ? Math.min(100, Math.max(0, ((loan.principal - loan.outstanding) / loan.principal) * 100))
      : 100
    const months = loanPayoffMonths(loan, 0, data.loanPayments)
    const cleared = loan.outstanding <= 0
    const payments = data.loanPayments
      .filter((payment) => payment.loan_id === loan.id)
      .sort((a, b) => a.payment_date.localeCompare(b.payment_date))

    return (
      <article className="card loan-card" key={loan.id}>
        <div className="loan-card-head">
          <div className={`kpi-icon ${isLent ? 'kpi-green' : isOneTime ? 'kpi-blue' : cleared ? 'kpi-green' : 'kpi-amber'}`}>
            {isLent ? <TrendingUp size={19} /> : isOneTime ? <HandCoins size={19} /> : <Landmark size={19} />}
          </div>
          <div>
            <h3>{loan.name}</h3>
            <span>
              {isLent ? 'Money lent · ' : 'Loan taken · '}
              {isOneTime ? 'one-time / hand loan' : `${formatPercent(loan.interest_rate)} p.a. · ${loan.tenure_months ? `${loan.tenure_months} month tenure` : 'flexible tenure'}`}
            </span>
          </div>
          <div className="row-actions">
            <button className="icon-button" title="Edit" onClick={() => setModal({ mode: 'edit', loan })}><Pencil size={16} /></button>
            <button className="icon-button danger" title="Remove" onClick={() => handleDelete(loan)}><Trash2 size={16} /></button>
          </div>
        </div>

        <div className="loan-amounts">
          <div>
            <span>{isLent ? 'Still owed to you' : 'Outstanding'}</span>
            <strong>{formatMoney(loan.outstanding, currency)}</strong>
          </div>
          <div>
            <span>{isLent ? 'Recovered' : isOneTime ? 'Interest' : 'EMI'}</span>
            <strong>
              {isLent
                ? `${paidPercent.toFixed(0)}%`
                : isOneTime
                  ? formatPercent(loan.interest_rate)
                  : `${formatMoney(loan.emi, currency)}/mo`}
            </strong>
          </div>
        </div>

        <div className="progress-track"><div className="progress-fill" style={{ width: `${paidPercent}%` }} /></div>
        <div className="progress-labels">
          <span>{paidPercent.toFixed(0)}% {isLent ? 'received' : 'paid'}</span>
          <span>Original {formatMoney(loan.principal, currency)}</span>
        </div>

        <div className="loan-facts">
          <div><CalendarDays size={15} /> {isOneTime ? `From ${formatDate(loan.start_date)}` : `Due day ${loan.due_day} · from ${formatDate(loan.start_date)}`}</div>
          {isOneTime && (
            <div><CalendarDays size={15} /> {loan.due_date ? `${isLent ? 'Expected repayment' : 'Planned repayment'} ${formatDate(loan.due_date)}` : 'No repayment date set'}</div>
          )}
          <div>
            {isLent ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
            {cleared
              ? isLent ? 'Fully repaid to you' : 'Fully repaid'
              : months === null
                ? 'No repayment planned yet'
                : months === 0
                  ? isLent ? 'Repayment this month' : 'Repay this month'
                  : `${isLent ? 'Money back' : 'Clears'} in ~${months} month${months === 1 ? '' : 's'}`}
          </div>
          {!isLent && <div><Zap size={15} /> Interest left {formatMoney(loanTotalInterest(loan, 0, data.loanPayments), currency)}</div>}
        </div>

        {payments.length > 0 && (
          <div className="payment-list">
            <span className="mini-subhead">
              {isLent ? 'Repayment dates' : 'Payment dates'} · {payments.length}
            </span>
            {payments.map((payment) => (
              <div className="payment-row" key={payment.id}>
                <span>{formatDate(payment.payment_date)}{payment.note ? ` · ${payment.note}` : ''}</span>
                <em className={`payment-tag ${payment.applied_to_balance ? 'tag-applied' : 'tag-planned'}`}>
                  {payment.applied_to_balance ? 'paid' : 'planned'}
                </em>
                <strong className={isLent ? 'positive' : ''}>{isLent ? '+' : '−'}{formatMoney(payment.amount, currency)}</strong>
                <button className="icon-button" title="Remove payment" onClick={() => handleDeletePayment(payment.id)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}

        {!cleared && (
          <div className="loan-actions">
            <button className="btn btn-outline btn-small" onClick={() => setPaymentModal(loan)}>
              <HandCoins size={15} /> {isLent ? 'Record repayment' : 'Record payment'}
            </button>
            {!isLent && (
              <button className="btn btn-outline btn-small" onClick={() => onPayFaster(loan.id)}><Zap size={15} /> Plan prepayment</button>
            )}
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">Debt & receivables</span>
          <h1>Loans</h1>
          <p>Track EMIs, interest-free hand loans, and money lent to others — with every lump-sum payment.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-outline" onClick={() => setModal({ mode: 'add', direction: 'lent' })}><TrendingUp size={16} /> Add money lent</button>
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'add', direction: 'borrowed' })}><Plus size={16} /> Add loan taken</button>
        </div>
      </header>

      <section className="stat-strip">
        <div><span>You owe</span><strong>{formatMoney(totalOwed, currency)}</strong></div>
        <div><span>Owed to you</span><strong className="positive">{formatMoney(totalReceivable, currency)}</strong></div>
        <div><span>Monthly EMI</span><strong className="negative">−{formatMoney(monthlyEmi, currency)}</strong></div>
        <div><span>Interest still to pay</span><strong>{formatMoney(totalInterest, currency)}</strong></div>
      </section>

      {handLoans.length > 0 && (
        <div className="notice-banner">
          <HandCoins size={19} />
          <div>
            <strong>{handLoans.length} interest-free hand loan{handLoans.length === 1 ? '' : 's'}</strong>
            <span>Set a repayment date or record partial payments so each month's cash flow stays accurate. Money lent appears as income when repaid.</span>
          </div>
        </div>
      )}

      {data.loans.length ? (
        <>
          {borrowed.length > 0 && (
            <section className="loan-section">
              <h2 className="section-heading">Loans you took <span>{borrowed.length}</span></h2>
              <div className="loan-grid">{borrowed.map(renderLoanCard)}</div>
            </section>
          )}
          {lent.length > 0 && (
            <section className="loan-section">
              <h2 className="section-heading">Money you lent <span>{lent.length}</span></h2>
              <div className="loan-grid">{lent.map(renderLoanCard)}</div>
            </section>
          )}
        </>
      ) : (
        <section className="card empty-state">
          <Landmark size={32} />
          <strong>No loans yet</strong>
          <span>Add a loan you took, or money you lent to someone, to forecast repayments.</span>
          <div className="header-actions">
            <button className="btn btn-outline btn-small" onClick={() => setModal({ mode: 'add', direction: 'lent' })}>Add money lent</button>
            <button className="btn btn-primary btn-small" onClick={() => setModal({ mode: 'add', direction: 'borrowed' })}>Add loan taken</button>
          </div>
        </section>
      )}

      {modal && (
        <Modal
          title={modal.mode === 'edit' ? 'Edit loan' : modal.direction === 'lent' ? 'Add money lent' : 'Add a loan'}
          subtitle="Choose EMI or a one-time hand loan — interest can be 0%."
          onClose={() => setModal(null)}
          wide
        >
          <LoanForm
            initial={modal.loan}
            defaultDirection={modal.direction}
            currency={currency}
            onCancel={() => setModal(null)}
            onSave={handleSave}
          />
        </Modal>
      )}

      {paymentModal && (
        <Modal
          title={`${paymentModal.direction === 'lent' ? 'Record repayment' : 'Record payment'} · ${paymentModal.name}`}
          subtitle="Adds a lump-sum cash flow in the chosen month and updates the loan balance."
          onClose={() => setPaymentModal(null)}
        >
          <LoanPaymentForm
            loanId={paymentModal.id}
            loanName={paymentModal.name}
            direction={paymentModal.direction}
            currency={currency}
            onCancel={() => setPaymentModal(null)}
            onSave={handlePaymentSave}
          />
        </Modal>
      )}
    </div>
  )
}
