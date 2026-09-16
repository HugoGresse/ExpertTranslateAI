import { describe, expect, it } from 'vitest'
import { buildAuthUrl, challengeFor, generateVerifier } from '../../src/adapters/auth'

describe('pkce', () => {
  it('generates url-safe verifiers of sufficient length', () => {
    const v = generateVerifier()
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(v.length).toBeGreaterThanOrEqual(43)
  })

  it('derives a deterministic S256 challenge', async () => {
    const a = await challengeFor('abc')
    const b = await challengeFor('abc')
    expect(a).toBe(b)
    expect(a).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
  })

  it('builds the OpenRouter auth url', () => {
    const url = new URL(buildAuthUrl('https://app.example/auth/callback', 'chal'))
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    expect(url.searchParams.get('callback_url')).toBe('https://app.example/auth/callback')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})
