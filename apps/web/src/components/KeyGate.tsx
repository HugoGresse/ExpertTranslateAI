import { useStore } from '@nanostores/react'
import type { FC } from 'react'
import { $keyLocked } from '../adapters/keyVault'
import { UnlockForm } from './KeyVaultCard'
import { basePath } from './ui'

export const KeyGate: FC = () => {
  const locked = useStore($keyLocked)
  if (locked)
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <UnlockForm />
      </div>
    )
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-medium">No OpenRouter key on this device.</p>
      <p className="mt-1">
        Add one in{' '}
        <a href={basePath('/settings')} className="text-accent underline">
          Settings
        </a>{' '}
        to start translating. The key stays in this browser.
      </p>
    </div>
  )
}
