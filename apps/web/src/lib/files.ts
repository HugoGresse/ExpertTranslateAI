/** Extensions and MIME types accepted wherever the app reads a text or Markdown file. */
export const TEXT_FILE_ACCEPT = '.txt,.md,.markdown,text/plain,text/markdown'

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown']

export const isTextFile = (file: File): boolean =>
  file.type.startsWith('text/') ||
  (file.type === '' && TEXT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)))

export const readTextFile = (file: File): Promise<string> => {
  if (!isTextFile(file))
    return Promise.reject(new Error(`${file.name} is not a text or Markdown file`))
  return file.text()
}
