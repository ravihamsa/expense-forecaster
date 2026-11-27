import type { Loan } from './types'

export interface LoanSummary {
  borrowedCount: number
  lentCount: number
  activeBorrowedCount: number
  activeLentCount: number
  /** What you still have to pay back. */
  owed: number
  /** What others still have to pay you back. */
  receivable: number
  /** Monthly EMI you pay on borrowed loans. */
  monthlyEmi: number
  /** Monthly EMI you receive on lent loans. */
  monthlyReceivable: number
}

/**
 * Separates loans taken from loans given. Money lent is an asset, not an
 * outstanding debt, so it must never be added to what you owe.
 */
export function summarizeLoans(loans: Loan[] = []): LoanSummary {
  const borrowed = loans.filter((loan) => loan.direction === 'borrowed')
  const lent = loans.filter((loan) => loan.direction === 'lent')
  const activeBorrowed = borrowed.filter((loan) => loan.outstanding > 0)
  const activeLent = lent.filter((loan) => loan.outstanding > 0)
  const amount = (loan: Loan) => Math.max(0, Number(loan.outstanding) || 0)
  const emi = (loan: Loan) => Math.max(0, Number(loan.emi) || 0)

  return {
    borrowedCount: borrowed.length,
    lentCount: lent.length,
    activeBorrowedCount: activeBorrowed.length,
    activeLentCount: activeLent.length,
    owed: activeBorrowed.reduce((sum, loan) => sum + amount(loan), 0),
    receivable: activeLent.reduce((sum, loan) => sum + amount(loan), 0),
    monthlyEmi: activeBorrowed
      .filter((loan) => loan.repayment_type === 'emi')
      .reduce((sum, loan) => sum + emi(loan), 0),
    monthlyReceivable: activeLent
      .filter((loan) => loan.repayment_type === 'emi')
      .reduce((sum, loan) => sum + emi(loan), 0),
  }
}
