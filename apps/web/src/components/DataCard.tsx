import { type FC, useState } from 'react'
import { type ExportBundle, exportAll, importAll } from '../adapters/dexieStorage'
import { logger } from '../adapters/logger'
import { downloadText } from '../lib/download'
import { Button, Card } from './ui'

const isBundle = (x: unknown): x is ExportBundle =>
  typeof x === 'object' &&
  x !== null &&
  'version' in x &&
  x.version === 1 &&
  'tables' in x &&
  typeof x.tables === 'object' &&
  x.tables !== null

export const DataCard: FC = () => {
  const [status, setStatus] = useState<string | null>(null)
  const doExport = async (): Promise<void> => {
    try {
      const bundle = await exportAll()
      downloadText(
        `experttranslate-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(bundle),
        'application/json',
      )
      setStatus('Exported. The OpenRouter key is never included.')
    } catch (error) {
      logger.error('data.exportFailed', { error: String(error) })
      setStatus('Export failed.')
    }
  }
  const doImport = async (file: File): Promise<void> => {
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isBundle(parsed)) throw new Error('Not an ExpertTranslateAI export')
      const count = await importAll(parsed)
      logger.info('data.imported', { rows: count })
      setStatus(`Imported ${count} rows. Reload the page to see everything.`)
    } catch (error) {
      logger.error('data.importFailed', { error: String(error) })
      setStatus(error instanceof Error ? error.message : 'Import failed.')
    }
  }
  return (
    <Card title="Your data">
      <p className="mb-3 text-xs text-neutral-500">
        Everything lives in this browser: history, context, guidelines, glossaries, memory,
        evaluation log and settings. Export a backup or move it to another browser.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void doExport()}>Export all as JSON</Button>
        <label className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50">
          Import JSON
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])}
          />
        </label>
      </div>
      {status ? <p className="mt-2 text-xs text-neutral-600">{status}</p> : null}
    </Card>
  )
}
