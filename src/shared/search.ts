import type { SearchMatchIn } from './types'

/**
 * ⌘K 搜索匹配/排序核心（纯逻辑，与 DB 解耦）。
 * 字段匹配在 JS 侧做（toLowerCase，Unicode 友好）；SQL 侧的 LIKE 只负责
 * 把含查询串的图注/照片标签行筛出来，是否计入 matchedIn 由这里的布尔入参决定。
 */

export const MATCH_RANK: Record<SearchMatchIn, number> = {
  title: 0,
  tags: 1,
  description: 2,
  caption: 3,
  photoTag: 4,
}

/** 单个旅行的字段命中集合（captionHit/photoTagHit 由 SQL 预筛结果传入） */
export function collectMatches(
  title: string,
  description: string,
  tags: string[],
  lowerQ: string,
  captionHit: boolean,
  photoTagHit: boolean,
): SearchMatchIn[] {
  const matchedIn: SearchMatchIn[] = []
  if (title.toLowerCase().includes(lowerQ)) matchedIn.push('title')
  if (description.toLowerCase().includes(lowerQ)) matchedIn.push('description')
  if (tags.some((t) => t.toLowerCase().includes(lowerQ))) matchedIn.push('tags')
  if (captionHit) matchedIn.push('caption')
  if (photoTagHit) matchedIn.push('photoTag')
  return matchedIn
}

/** 排序名次：命中最优字段越靠前 */
export function rankOf(matchedIn: SearchMatchIn[]): number {
  return Math.min(...matchedIn.map((m) => MATCH_RANK[m]))
}

/** 同名次内按开始日期倒序 */
export function compareHits(
  a: { rank: number; startDate: string },
  b: { rank: number; startDate: string },
): number {
  return a.rank - b.rank || b.startDate.localeCompare(a.startDate)
}
