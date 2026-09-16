const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

/** `String.slice` that never splits a surrogate pair: both bounds move inward when they land inside one. */
export function sliceSafe(text: string, start: number, end: number = text.length): string {
  let from = Math.max(0, Math.min(start, text.length))
  let to = Math.max(from, Math.min(end, text.length))
  if (from > 0 && from < text.length && isLowSurrogate(text.charCodeAt(from))) from++
  if (to > from && to < text.length && isHighSurrogate(text.charCodeAt(to - 1))) to--
  return text.slice(from, to)
}
