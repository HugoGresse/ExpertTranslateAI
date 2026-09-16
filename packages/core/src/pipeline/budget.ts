import { BudgetExceededError, type Usage } from '../types.ts'

export interface BudgetTracker {
  readonly spentUsd: number
  readonly budgetUsd: number | null
  spend(usage: Usage): void
  check(): void
}

export function createBudgetTracker(budgetUsd: number | null): BudgetTracker {
  let spent = 0
  return {
    get spentUsd() {
      return spent
    },
    budgetUsd,
    spend(usage) {
      spent += usage.costUsd ?? 0
    },
    check() {
      if (budgetUsd !== null && spent > budgetUsd) throw new BudgetExceededError(spent, budgetUsd)
    },
  }
}
