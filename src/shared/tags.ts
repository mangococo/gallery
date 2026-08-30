/**
 * 标签规范化纯逻辑：旅行标签与照片标签共用（入库前必经）。
 * trim、去空、去重（保留首次出现顺序）。
 */
export function normalizeTagNames(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}
