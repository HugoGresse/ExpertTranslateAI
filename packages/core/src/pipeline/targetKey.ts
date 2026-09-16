export const targetKey = (t: { lang: string; region?: string | undefined }): string =>
  t.region ? `${t.lang}#${t.region.trim().toLowerCase()}` : t.lang

export const resultKey = (jobId: string, key: string): string => `${jobId}:${key}`
