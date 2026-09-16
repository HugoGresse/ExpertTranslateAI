import { useStore } from '@nanostores/react'
import { type FC, useState } from 'react'
import {
  $apiKey,
  $keyLocked,
  isKeyEncrypted,
  protectApiKey,
  unlockApiKey,
  unprotectApiKey,
} from '../adapters/keyVault'
import { logger } from '../adapters/logger'
import { Button, Field, inputClass } from './ui'

export const UnlockForm: FC = () => {
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const unlock = async (): Promise<void> => {
    try {
      await unlockApiKey(passphrase)
      setPassphrase('')
      setError(null)
    } catch (e) {
      logger.warn('keyVault.unlockFailed')
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        Your OpenRouter key is encrypted on this device. Enter the passphrase to use it for this
        session.
      </p>
      <div className="flex gap-2">
        <input
          className={`${inputClass} flex-1`}
          type="password"
          placeholder="Passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void unlock()}
          aria-label="Passphrase"
        />
        <Button variant="primary" onClick={() => void unlock()}>
          Unlock
        </Button>
      </div>
      {error ? <p className="text-red-700">{error}</p> : null}
    </div>
  )
}

export const KeyVaultCard: FC = () => {
  const apiKey = useStore($apiKey)
  const locked = useStore($keyLocked)
  const [passphrase, setPassphrase] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const encrypted = isKeyEncrypted()
  if (locked) return <UnlockForm />
  if (!apiKey) return null
  const protect = async (): Promise<void> => {
    if (passphrase.length < 8) {
      setStatus('Use at least 8 characters.')
      return
    }
    await protectApiKey(passphrase)
    setPassphrase('')
    setStatus('Key encrypted. You will be asked for the passphrase after each reload.')
  }
  return (
    <div className="mt-3 flex flex-col gap-2 text-sm">
      {encrypted ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-green-700">Encrypted at rest (AES-GCM, passphrase-derived).</span>
          <Button
            onClick={() =>
              void unprotectApiKey().then(() =>
                setStatus('Key stored in plain local storage again.'),
              )
            }
          >
            Store unencrypted
          </Button>
        </div>
      ) : (
        <Field
          label="Encrypt the key with a passphrase"
          hint="Anyone with access to this browser profile can otherwise read it."
        >
          <div className="flex gap-2">
            <input
              className={`${inputClass} flex-1`}
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              aria-label="New passphrase"
            />
            <Button onClick={() => void protect()}>Encrypt</Button>
          </div>
        </Field>
      )}
      {status ? <p className="text-xs text-neutral-600">{status}</p> : null}
    </div>
  )
}
