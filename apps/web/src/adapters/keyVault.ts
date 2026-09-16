import { atom } from 'nanostores'

const STORAGE_KEY = 'eta.openrouter.key'

const read = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export const $apiKey = atom<string | null>(typeof localStorage === 'undefined' ? null : read())

export function saveApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key.trim())
  $apiKey.set(key.trim())
}

export function forgetApiKey(): void {
  localStorage.removeItem(STORAGE_KEY)
  $apiKey.set(null)
}

export const maskKey = (key: string): string =>
  key.length <= 10 ? '••••' : `${key.slice(0, 6)}…${key.slice(-4)}`
