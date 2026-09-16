import { BudgetExceededError, type Usage } from '../types.ts'

export interface BudgetTracker {
  readonly spentUsd: number
  readonly budgetUsd: number | null
  spend(usage: Usage): void
  check(): void
  begin(): void
  end(): void
}

export function createBudgetTracker(budgetUsd: number | null): BudgetTracker {
  let spent = 0
  let completed = 0
  let inFlight = 0
  return {
    get spentUsd() {
      return spent
    },
    budgetUsd,
    spend(usage) {
      spent += usage.costUsd ?? 0
      completed++
    },
    begin() {
      inFlight++
    },
    end() {
      inFlight = Math.max(0, inFlight - 1)
    },
    check() {
      if (budgetUsd === null) return
      const averageCall = completed > 0 ? spent / completed : 0
      const projected = spent + inFlight * averageCall
      if (spent > budgetUsd || projected > budgetUsd)
        throw new BudgetExceededError(spent, budgetUsd)
    },
  }
}
