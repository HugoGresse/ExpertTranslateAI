export function downloadText(
  filename: string,
  text: string,
  type = 'text/plain;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
