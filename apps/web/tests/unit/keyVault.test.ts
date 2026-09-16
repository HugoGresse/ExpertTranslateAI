import { describe, expect, it } from 'vitest'
import { decryptKey, encryptKey } from '../../src/adapters/keyVault'

describe('key vault crypto', () => {
  it('round-trips a key and rejects a wrong passphrase', async () => {
    const blob = await encryptKey('sk-or-secret-123', 'correct horse battery')
    expect(blob.salt).not.toBe(blob.iv)
    expect(await decryptKey(blob, 'correct horse battery')).toBe('sk-or-secret-123')
    await expect(decryptKey(blob, 'wrong')).rejects.toThrow()
  })
  it('uses a fresh salt and iv per encryption', async () => {
    const a = await encryptKey('k', 'p')
    const b = await encryptKey('k', 'p')
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
  })
})
