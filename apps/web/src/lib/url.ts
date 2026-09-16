/** Adds https:// when the scheme is missing and rejects anything that is not http(s). */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Enter a URL first')
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error('That does not look like a valid URL')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new Error('Only http(s) URLs are supported')
  return parsed.toString()
}
