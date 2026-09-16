import pkg from '../package.json' with { type: 'json' }

/** Reported by /api/health; comes from package.json so releases bump one place. */
export const SERVER_VERSION: string = pkg.version
