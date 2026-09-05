/**
 * 日期字符串与时间戳的本地时区工具（主/渲染进程共用）。
 * 背景：date-only 字符串（'YYYY-MM-DD'）按 ES 规范被解析为 UTC 午夜，
 * toISOString() 也按 UTC 序列化——东八区的本地凌晨会被写成前一天，
 * 西半球时区则整体偏一天。日期的入库与展示一律走这里的本地化路径。
 */

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 毫秒时间戳 → 本地时区 YYYY-MM-DD */
export function msToLocalDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Date → 本地时区 YYYY-MM-DD（DatePicker 选定值入库用，替代 toISOString） */
export function dateToLocalStr(d: Date): string {
  return msToLocalDate(d.getTime())
}

/** 'YYYY-MM-DD' → 本地午夜的 Date；格式非法返回 NaN 日期（调用方自行判断） */
export function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim())
  if (!m) return new Date(NaN)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** 'YYYY-MM-DD' → 'YYYY.MM.DD'；空串给占位符，非法格式原样返回 */
export function formatDotDate(s: string, placeholder = '——'): string {
  if (!s) return placeholder
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replaceAll('-', '.') : s
}

/** 毫秒时间戳 → 'YYYY.MM.DD'（本地时区；EXIF 拍摄时间展示用） */
export function formatDotFromMs(ms: number): string {
  return formatDotDate(msToLocalDate(ms))
}
