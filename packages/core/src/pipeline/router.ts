import type { Domain, RoleModels, RouterRule } from '../types.ts'

export function routeModels(
  base: RoleModels,
  rules: RouterRule[],
  domain: Domain | null,
): RoleModels {
  if (!domain) return base
  const out: RoleModels = { ...base }
  for (const rule of rules) {
    if (rule.domain === domain && rule.model.trim()) out[rule.role] = rule.model.trim()
  }
  return out
}
