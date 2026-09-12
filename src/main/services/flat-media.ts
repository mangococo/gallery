/**
 * 相册根目录平铺媒体文件的纯决策层：不依赖 db / electron / fs，可单元测试。
 * ipc.ts 只做 IO 与入库，这里回答「哪些条目算平铺媒体文件」。
 */

export interface RootEntryFact {
  name: string
  isDirectory: boolean
}

/**
 * 平铺媒体文件 = 相册根目录下非隐藏的媒体「文件」：
 * - 子目录不算（由旅行扫描处理，平铺归档不影响既有「子目录 = 旅行」模型）
 * - 隐藏文件不算（.DS_Store / .settings.json 残留等）
 * - 非媒体文件不算（index.html、说明 txt 等）
 */
export function splitFlatMediaFiles(
  entries: RootEntryFact[],
  isMediaName: (name: string) => boolean,
): string[] {
  return entries
    .filter((e) => !e.isDirectory && !e.name.startsWith('.') && isMediaName(e.name))
    .map((e) => e.name)
}
