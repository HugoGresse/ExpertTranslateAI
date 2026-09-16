const VERIFIER_KEY = 'eta.pkce.verifier'
const AUTH_URL = 'https://openrouter.ai/auth'
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys'

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export function generateVerifier(): string {
  const bytes = new Uint8Array(48)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

export function buildAuthUrl(callbackUrl: string, challenge: string): string {
  const url = new URL(AUTH_URL)
  url.searchParams.set('callback_url', callbackUrl)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export async function startOAuth(callbackUrl: string): Promise<void> {
  const verifier = generateVerifier()
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  const challenge = await challengeFor(verifier)
  window.location.assign(buildAuthUrl(callbackUrl, challenge))
}

export async function exchangeCode(code: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  if (!verifier) throw new Error('Missing PKCE verifier. Start the connection again from Settings.')
  const res = await fetchImpl(EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  })
  if (!res.ok) throw new Error(`Key exchange failed with HTTP ${res.status}`)
  const json = (await res.json()) as { key?: string }
  if (!json.key) throw new Error('Key exchange returned no key')
  sessionStorage.removeItem(VERIFIER_KEY)
  return json.key
}
