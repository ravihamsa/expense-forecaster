import type { AppCategory, FlowKind } from './types'

export const EXPENSE_CATEGORIES = [
  'Housing', 'Utilities', 'Groceries', 'Transport', 'Insurance', 'Health', 'Education',
  'Shopping', 'Dining', 'Entertainment', 'Subscriptions', 'Travel', 'Lifestyle',
  'Hobbies', 'Investments', 'Other',
]

export const INCOME_CATEGORIES = [
  'Salary', 'Business', 'Freelance', 'Rent Received', 'Interest', 'Dividends', 'Gifts', 'Other',
]

export function categorySlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other'
}

export function defaultCategoryId(kind: FlowKind, name: string): string {
  return `default-${kind}-${categorySlug(name)}`
}

/** Seed rows for a user who has never customised their category list. */
export function defaultCategories(userId: string): AppCategory[] {
  return [
    ...EXPENSE_CATEGORIES.map((name) => ({
      id: defaultCategoryId('expense', name),
      user_id: userId,
      name,
      kind: 'expense' as const,
    })),
    ...INCOME_CATEGORIES.map((name) => ({
      id: defaultCategoryId('income', name),
      user_id: userId,
      name,
      kind: 'income' as const,
    })),
  ]
}

export function categoriesOfKind(categories: AppCategory[], kind: FlowKind): string[] {
  return categories
    .filter((category) => category.kind === kind)
    .map((category) => category.name)
    .sort((a, b) => a.localeCompare(b))
}
