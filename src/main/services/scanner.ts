import { promises as fs } from 'fs'
import { join } from 'path'
import { nanoid } from 'nanoid'
import type { ScanProgress } from '../../shared/types'
import {
  getAlbumRow,
  getPhotoIdByTripAndName,
  getTripIdByFolder,
  getTripRow,
  insertPhotoRow,
  insertTripRow,
  listPhotoFilesOfTrip,
  setAlbumStatus,
  setSetting,
  setTagsOfTrip,
  deletePhotoRow,
  updatePhotoTakenAt,
  updateTripRow,
} from '../db'

// —— 旧 .settings.json 解析 ——

export interface LegacySettings {
  id?: string
  title?: string
  description?: string
  startDate?: string
  endDate?: string
  tags?: string[]
  isFavorite?: boolean
  photoCaptions?: Record<string, string>
}

/** 图片/视频扩展名（大小写不敏感） */
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.tiff'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm'])

export function mediaTypeOf(fileName: string): 'image' | 'video' | null {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return null
  const ext = fileName.slice(dot).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  return null
}

async function readLegacySettings(dir: string): Promise<LegacySettings | null> {
  try {
    const raw = await fs.readFile(join(dir, '.settings.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

/** 文件名排序：数字感知，保证时间线内照片顺序稳定 */
function compareFileNames(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}

export interface ScanCounters {
  trips: number
  photos: number
  skippedCaptions: number
}

export interface ScanHooks {
  /** 推送进度到渲染层 */
  progress(p: ScanProgress): void
  /** 扫描完成后调用（用于触发缩略图队列等） */
  finished(albumId: string, counters: ScanCounters): void
}

/**
 * 扫描相册目录入库：
 * - 只处理子目录；根目录散落的 index.html / .DS_Store 等一律跳过
 * - 子目录含媒体文件或 .settings.json 即收录为旅行（空目录跳过）
 * - 新发现的旅行从 .settings.json 导入元数据（保留旧 id）；已入库旅行不覆盖用户编辑
 * - 文件级增量校对：以 文件名 + mtime 对比（taken_at 即 mtime）
 */
export async function scanAlbum(albumId: string, hooks: ScanHooks): Promise<ScanCounters | null> {
  const album = getAlbumRow(albumId)
  if (!album) return null

  try {
    await fs.access(album.path)
    setAlbumStatus(albumId, 'ok')
  } catch {
    setAlbumStatus(albumId, 'missing')
    return null
  }

  const counters: ScanCounters = { trips: 0, photos: 0, skippedCaptions: 0 }

  let entries: string[]
  try {
    entries = await fs.readdir(album.path)
  } catch {
    setAlbumStatus(albumId, 'missing')
    return null
  }

  // 只保留子目录（忽略 . 开头的隐藏目录；根目录的 index.html / .DS_Store 自然跳过）
  const dirs: string[] = []
  for (const name of entries) {
    if (name.startsWith('.')) continue
    try {
      const st = await fs.stat(join(album.path, name))
      if (st.isDirectory()) dirs.push(name)
    } catch {
      // 竞态：目录刚好消失
    }
  }

  const push = makeProgressThrottler(hooks.progress)
  const total = dirs.length
  push({ albumId, albumName: album.name, phase: 'scan', done: 0, total })

  for (const folderName of dirs) {
    const dirPath = join(album.path, folderName)
    const settings = await readLegacySettings(dirPath)

    let fileNames: string[] = []
    try {
      const raw = await fs.readdir(dirPath)
      fileNames = raw.filter((f) => !f.startsWith('.') && mediaTypeOf(f) !== null)
    } catch {
      // 目录读取失败按空处理
    }

    // 决策 15：含媒体或已有 .settings.json 才收录
    if (fileNames.length === 0 && !settings) continue

    await reconcileTrip(albumId, folderName, dirPath, settings, fileNames, counters, (label) =>
      push({ albumId, albumName: album.name, phase: 'scan', done: counters.trips, total, label }),
    )
  }

  push({ albumId, albumName: album.name, phase: 'scan', done: total, total })

  setSetting(`last_scan_${albumId}`, String(Date.now()))
  hooks.finished(albumId, counters)
  return counters
}

/**
 * 单个旅行目录的入库与增量校对。
 * caption 匹配一律大小写不敏感；指向已改名/已删除文件的残留键静默跳过。
 */
async function reconcileTrip(
  albumId: string,
  folderName: string,
  dirPath: string,
  settings: LegacySettings | null,
  fileNames: string[],
  counters: ScanCounters,
  tick: (label: string) => void,
): Promise<void> {
  let tripId = getTripIdByFolder(albumId, folderName)
  let isNew = false

  if (!tripId) {
    // 新旅行：旧数据保留时间戳字符串 id；旧 id 与已有旅行冲突时换新 id
    let id = settings?.id != null && String(settings.id).trim() !== '' ? String(settings.id) : nanoid(12)
    if (getTripRow(id)) id = nanoid(12)
    insertTripRow({
      id,
      albumId,
      folderName,
      title: settings?.title?.trim() || folderName,
      description: settings?.description ?? '',
      startDate: settings?.startDate ?? '',
      endDate: settings?.endDate ?? '',
      isFavorite: !!settings?.isFavorite,
    })
    if (settings?.tags?.length) setTagsOfTrip(id, settings.tags)
    tripId = id
    isNew = true
    counters.trips++
  }

  // 磁盘文件表（key: 小写文件名 → 原名 + mtime）
  const diskFiles = new Map<string, { name: string; mtimeMs: number }>()
  for (const name of fileNames.sort(compareFileNames)) {
    try {
      const st = await fs.stat(join(dirPath, name))
      diskFiles.set(name.toLowerCase(), { name, mtimeMs: st.mtimeMs })
      tick(`${folderName}/${name}`)
    } catch {
      // 竞态跳过
    }
  }

  // caption 映射：小写键 → caption；与磁盘文件大小写不敏感匹配，残留键静默跳过
  const captionMap = new Map<string, string>()
  if (settings?.photoCaptions) {
    for (const [k, v] of Object.entries(settings.photoCaptions)) {
      captionMap.set(k.toLowerCase(), typeof v === 'string' ? v : '')
      if (!diskFiles.has(k.toLowerCase())) counters.skippedCaptions++
    }
  }

  const dbFiles = listPhotoFilesOfTrip(tripId)
  const dbByName = new Map(dbFiles.map((f) => [f.fileName.toLowerCase(), f]))

  // 入库新文件 / 校对被替换的文件
  for (const [key, disk] of diskFiles) {
    const existing = dbByName.get(key)
    if (!existing) {
      insertPhotoRow({
        id: nanoid(12),
        tripId,
        fileName: disk.name,
        relPath: `${folderName}/${disk.name}`,
        type: mediaTypeOf(disk.name)!,
        caption: captionMap.get(key) ?? '',
        takenAt: Math.round(disk.mtimeMs),
      })
      counters.photos++
    } else if (existing.takenAt !== null && Math.abs(existing.takenAt - disk.mtimeMs) > 500) {
      // 同名但文件内容被替换（mtime 变化）：更新并重新生成缩略图
      updatePhotoTakenAt(existing.id, Math.round(disk.mtimeMs))
    }
  }

  // 清理磁盘上已不存在的记录
  for (const [key, dbFile] of dbByName) {
    if (!diskFiles.has(key)) deletePhotoRow(dbFile.id)
  }

  // 新旅行默认第一张为封面
  if (isNew && diskFiles.size > 0) {
    const firstName = diskFiles.values().next().value!.name
    const coverId = getPhotoIdByTripAndName(tripId, firstName)
    if (coverId) updateTripRow(tripId, { coverPhotoId: coverId })
  }
}

function makeProgressThrottler(push: ScanHooks['progress']): (p: ScanProgress) => void {
  let last = 0
  return (p) => {
    const now = Date.now()
    if (now - last > 120 || p.done >= p.total) {
      last = now
      push(p)
    }
  }
}
