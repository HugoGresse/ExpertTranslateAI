import { atom } from 'nanostores'
import { logger } from './logger'

const PLAIN_KEY = 'eta.openrouter.key'
const ENC_KEY = 'eta.openrouter.key.enc'
const SESSION_KEY = 'eta.openrouter.key.session'

const readSession = (): string | null => {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}
const writeSession = (value: string | null): void => {
  try {
    if (value === null) sessionStorage.removeItem(SESSION_KEY)
    else sessionStorage.setItem(SESSION_KEY, value)
  } catch {
    /* session storage unavailable */
  }
}

interface EncryptedBlob {
  salt: string
  iv: string
  data: string
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

type Bytes = Uint8Array<ArrayBuffer>

const toB64 = (bytes: Bytes): string => btoa(String.fromCharCode(...bytes))
const fromB64 = (text: string): Bytes => {
  const decoded = atob(text)
  const out = new Uint8Array(new ArrayBuffer(decoded.length))
  for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i)
  return out
}
const randomBytes = (length: number): Bytes =>
  crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)))
const utf8 = (text: string): Bytes => {
  const encoded = new TextEncoder().encode(text)
  const out = new Uint8Array(new ArrayBuffer(encoded.byteLength))
  out.set(encoded)
  return out
}

async function deriveKey(passphrase: string, salt: Bytes): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptKey(apiKey: string, passphrase: string): Promise<EncryptedBlob> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(passphrase, salt)
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, utf8(apiKey))
  // subtle.encrypt returns a plain ArrayBuffer, so the view is backed by ArrayBuffer
  return { salt: toB64(salt), iv: toB64(iv), data: toB64(new Uint8Array(data) as Bytes) }
}

export async function decryptKey(blob: EncryptedBlob, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromB64(blob.salt))
  const data = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) },
    key,
    fromB64(blob.data),
  )
  return new TextDecoder().decode(data)
}

const readEncrypted = (): EncryptedBlob | null => {
  const raw = read(ENC_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'salt' in parsed &&
      'iv' in parsed &&
      'data' in parsed
    ) {
      // shape checked field by field above; JSON.parse gives unknown
      return parsed as EncryptedBlob
    }
  } catch {
    /* corrupt blob */
  }
  return null
}

const initialPlain = typeof localStorage === 'undefined' ? null : read(PLAIN_KEY)
const initialBlob = typeof localStorage === 'undefined' ? null : readEncrypted()
const initialSession = initialBlob && typeof sessionStorage !== 'undefined' ? readSession() : null

export const $apiKey = atom<string | null>(initialPlain ?? initialSession)
export const $keyEncrypted = atom<boolean>(initialBlob !== null)
export const $keyLocked = atom<boolean>(
  initialBlob !== null && initialPlain === null && initialSession === null,
)

export const isKeyEncrypted = (): boolean => $keyEncrypted.get()

export function saveApiKey(key: string): { replacedVault: boolean } {
  const replacedVault = readEncrypted() !== null
  if (replacedVault) logger.warn('keyVault.replaced', { encrypted: true })
  localStorage.setItem(PLAIN_KEY, key.trim())
  localStorage.removeItem(ENC_KEY)
  writeSession(null)
  $apiKey.set(key.trim())
  $keyEncrypted.set(false)
  $keyLocked.set(false)
  return { replacedVault }
}

export function forgetApiKey(): void {
  localStorage.removeItem(PLAIN_KEY)
  localStorage.removeItem(ENC_KEY)
  writeSession(null)
  $apiKey.set(null)
  $keyEncrypted.set(false)
  $keyLocked.set(false)
}

export async function protectApiKey(passphrase: string): Promise<void> {
  const key = $apiKey.get()
  if (!key) throw new Error('No key to protect')
  const blob = await encryptKey(key, passphrase)
  localStorage.setItem(ENC_KEY, JSON.stringify(blob))
  localStorage.removeItem(PLAIN_KEY)
  writeSession(key)
  $keyEncrypted.set(true)
  $keyLocked.set(false)
  logger.info('keyVault.protected')
}

export async function unlockApiKey(passphrase: string): Promise<void> {
  const blob = readEncrypted()
  if (!blob) throw new Error('No encrypted key stored')
  try {
    const key = await decryptKey(blob, passphrase)
    writeSession(key)
    $apiKey.set(key)
    $keyLocked.set(false)
    logger.info('keyVault.unlocked')
  } catch (error) {
    logger.warn('keyVault.unlockFailed', {
      error: error instanceof Error ? error.name : String(error),
    })
    throw new Error('Wrong passphrase or corrupted key store')
  }
}

export async function unprotectApiKey(): Promise<void> {
  const key = $apiKey.get()
  if (!key) throw new Error('Unlock the key first')
  localStorage.setItem(PLAIN_KEY, key)
  localStorage.removeItem(ENC_KEY)
  writeSession(null)
  $keyEncrypted.set(false)
  $keyLocked.set(false)
  logger.info('keyVault.unprotected')
}

export function lockApiKey(): void {
  if (!$keyEncrypted.get()) return
  writeSession(null)
  $apiKey.set(null)
  $keyLocked.set(true)
  logger.info('keyVault.locked')
}

export const maskKey = (key: string): string =>
  key.length <= 10 ? '••••' : `${key.slice(0, 6)}…${key.slice(-4)}`
