import type { CostSummary, ModelInfo, ModelPricing, Usage } from '../types.ts'

export function usageCost(
  usage: Pick<Usage, 'promptTokens' | 'completionTokens'>,
  pricing: ModelPricing,
): number {
  return (
    usage.promptTokens * pricing.promptUsdPerToken +
    usage.completionTokens * pricing.completionUsdPerToken
  )
}

export function findPricing(models: ModelInfo[], modelId: string): ModelPricing | undefined {
  return models.find((m) => m.id === modelId)?.pricing
}

export const emptyCost = (): CostSummary => ({ usd: 0, tokensIn: 0, tokensOut: 0, calls: 0 })

export function addUsage(cost: CostSummary, usage: Usage): CostSummary {
  return {
    usd: cost.usd + (usage.costUsd ?? 0),
    tokensIn: cost.tokensIn + usage.promptTokens,
    tokensOut: cost.tokensOut + usage.completionTokens,
    calls: cost.calls + 1,
  }
}

export function sumCosts(costs: CostSummary[]): CostSummary {
  return costs.reduce(
    (acc, c) => ({
      usd: acc.usd + c.usd,
      tokensIn: acc.tokensIn + c.tokensIn,
      tokensOut: acc.tokensOut + c.tokensOut,
      calls: acc.calls + c.calls,
    }),
    emptyCost(),
  )
}
