export const targetKey = (t: { lang: string; region?: string | undefined }): string =>
  t.region ? `${t.lang}#${t.region.trim().toLowerCase()}` : t.lang

/** A target key usable as a file name segment (`fr#canada` → `fr-canada`). */
export const fileSafeTargetKey = (key: string): string => key.replace(/[#/\\:]/g, '-')

export const resultKey = (jobId: string, key: string): string => `${jobId}:${key}`
