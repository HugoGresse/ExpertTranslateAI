import { type FC, useState } from 'react'
import { logger } from '../adapters/logger'
import { isTextFile, readTextFile, TEXT_FILE_ACCEPT } from '../lib/files'

export interface SourceInputProps {
  value: string
  onChange: (text: string) => void
}

/** Source textarea that also accepts a dropped or picked .txt/.md file; plain text drops keep the browser default. */
export const SourceInput: FC<SourceInputProps> = ({ value, onChange }) => {
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const loadFile = async (file: File): Promise<void> => {
    setNotice(null)
    try {
      onChange(await readTextFile(file))
      logger.info('source.fileLoaded', { name: file.name, type: file.type, size: file.size })
    } catch (error) {
      logger.warn('source.fileRejected', { name: file.name, type: file.type, error: String(error) })
      setNotice(error instanceof Error ? error.message : String(error))
    }
  }

  const hasFiles = (dt: DataTransfer): boolean => Array.from(dt.types).includes('Files')

  return (
    <div>
      <textarea
        className={`min-h-64 w-full rounded-md border p-2 text-sm ${dragging ? 'border-accent bg-blue-50' : 'border-neutral-300'}`}
        placeholder="Paste text or Markdown to translate… or drop a .txt / .md file"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onDragOver={(e) => {
          if (!hasFiles(e.dataTransfer)) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (!file) return
          e.preventDefault()
          if (isTextFile(file)) void loadFile(file)
          else setNotice(`${file.name} is not a text or Markdown file`)
        }}
      />
      <div className="mt-1 flex items-center gap-3 text-xs">
        <label className="cursor-pointer text-accent underline">
          Load a file
          <input
            type="file"
            accept={TEXT_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void loadFile(file)
            }}
          />
        </label>
        {notice ? <span className="text-red-700">{notice}</span> : null}
      </div>
    </div>
  )
}
