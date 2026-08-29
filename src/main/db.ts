import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import type { Album, PhotoDTO, PhotoType, ThumbStatus, TripDTO } from '../shared/types'

let db: Database.Database

/** 初始化 SQLite（userData/gallery.db），建表迁移（幂等） */
export function initDb(): void {
  if (db) return
  db = new Database(join(app.getPath('userData'), 'gallery.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate()
}

export function closeDb(): void {
  db?.close()
}

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      folder_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_date TEXT,
      end_date TEXT,
      is_favorite INTEGER DEFAULT 0,
      cover_photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(album_id, folder_name)
    );

    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('image','video')),
      caption TEXT DEFAULT '',
      width INTEGER,
      height INTEGER,
      thumb_status TEXT DEFAULT 'pending',
      taken_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trip_tags (
      trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE,
      tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (trip_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_photos_trip ON photos(trip_id);
    CREATE INDEX IF NOT EXISTS idx_trip_tags_tag ON trip_tags(tag_id);
  `)
}

// ---------- settings ----------

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

// ---------- albums ----------

interface AlbumRow {
  id: string
  name: string
  path: string
  status: string
  created_at: number | null
}

function rowToAlbum(r: AlbumRow): Album {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    status: r.status === 'missing' ? 'missing' : 'ok',
    createdAt: r.created_at ?? 0,
  }
}

export function listAlbumRows(): Album[] {
  return (db.prepare('SELECT * FROM albums ORDER BY created_at').all() as AlbumRow[]).map(
    rowToAlbum,
  )
}

export function getAlbumRow(id: string): Album | null {
  const r = db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as AlbumRow | undefined
  return r ? rowToAlbum(r) : null
}

export function getAlbumRowByPath(path: string): Album | null {
  const r = db.prepare('SELECT * FROM albums WHERE path = ?').get(path) as AlbumRow | undefined
  return r ? rowToAlbum(r) : null
}

export function insertAlbumRow(album: Album): void {
  db.prepare(
    'INSERT INTO albums (id, name, path, status, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(album.id, album.name, album.path, album.status, album.createdAt)
}

export function updateAlbumPath(id: string, path: string): void {
  db.prepare('UPDATE albums SET path = ?, status = ? WHERE id = ?').run(path, 'ok', id)
}

export function renameAlbumRow(id: string, name: string): void {
  db.prepare('UPDATE albums SET name = ? WHERE id = ?').run(name, id)
}

export function setAlbumStatus(id: string, status: 'ok' | 'missing'): void {
  db.prepare('UPDATE albums SET status = ? WHERE id = ?').run(status, id)
}

export function removeAlbumRow(id: string): void {
  db.prepare('DELETE FROM albums WHERE id = ?').run(id)
}

/** 协议层用：相册根目录（缺失返回 null） */
export function getAlbumPath(albumId: string): string | null {
  const r = db.prepare('SELECT path FROM albums WHERE id = ?').get(albumId) as
    | { path: string }
    | undefined
  return r?.path ?? null
}

// ---------- trips ----------

interface TripRow {
  id: string
  album_id: string
  folder_name: string
  title: string
  description: string | null
  start_date: string | null
  end_date: string | null
  is_favorite: number | null
  cover_photo_id: string | null
  created_at: number | null
  updated_at: number | null
}

function rowToTrip(r: TripRow): Omit<TripDTO, 'tags' | 'photos'> {
  return {
    id: r.id,
    albumId: r.album_id,
    folderName: r.folder_name,
    title: r.title,
    description: r.description ?? '',
    startDate: r.start_date ?? '',
    endDate: r.end_date ?? '',
    isFavorite: !!r.is_favorite,
    coverPhotoId: r.cover_photo_id,
    createdAt: r.created_at ?? 0,
    updatedAt: r.updated_at ?? 0,
  }
}

export interface NewTripRecord {
  id: string
  albumId: string
  folderName: string
  title: string
  description: string
  startDate: string
  endDate: string
  isFavorite: boolean
}

export function insertTripRow(t: NewTripRecord): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO trips (id, album_id, folder_name, title, description, start_date, end_date, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(t.id, t.albumId, t.folderName, t.title, t.description, t.startDate, t.endDate, t.isFavorite ? 1 : 0, now, now)
}

export function getTripRow(id: string): Omit<TripDTO, 'tags' | 'photos'> | null {
  const r = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as TripRow | undefined
  return r ? rowToTrip(r) : null
}

export function getTripIdByFolder(albumId: string, folderName: string): string | null {
  const r = db
    .prepare('SELECT id FROM trips WHERE album_id = ? AND folder_name = ?')
    .get(albumId, folderName) as { id: string } | undefined
  return r?.id ?? null
}

export function listTripRows(albumId: string): Omit<TripDTO, 'tags' | 'photos'>[] {
  return (
    db
      .prepare(
        `SELECT * FROM trips WHERE album_id = ?
         ORDER BY CASE WHEN start_date IS NULL OR start_date = '' THEN 1 ELSE 0 END,
                  start_date DESC, created_at DESC`,
      )
      .all(albumId) as TripRow[]
  ).map(rowToTrip)
}

export interface TripUpdate {
  title?: string
  description?: string
  startDate?: string
  endDate?: string
  isFavorite?: boolean
  coverPhotoId?: string | null
}

export function updateTripRow(id: string, u: TripUpdate): void {
  const sets: string[] = []
  const vals: (string | number | null)[] = []
  if (u.title !== undefined) { sets.push('title = ?'); vals.push(u.title) }
  if (u.description !== undefined) { sets.push('description = ?'); vals.push(u.description) }
  if (u.startDate !== undefined) { sets.push('start_date = ?'); vals.push(u.startDate) }
  if (u.endDate !== undefined) { sets.push('end_date = ?'); vals.push(u.endDate) }
  if (u.isFavorite !== undefined) { sets.push('is_favorite = ?'); vals.push(u.isFavorite ? 1 : 0) }
  if (u.coverPhotoId !== undefined) { sets.push('cover_photo_id = ?'); vals.push(u.coverPhotoId) }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  vals.push(Date.now())
  vals.push(id)
  db.prepare(`UPDATE trips SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function deleteTripRow(id: string): void {
  db.prepare('DELETE FROM trips WHERE id = ?').run(id)
}

export function deleteTripsOfAlbum(albumId: string): void {
  db.prepare('DELETE FROM trips WHERE album_id = ?').run(albumId)
}

// ---------- tags ----------

export function getTagsOfTrip(tripId: string): string[] {
  return (
    db
      .prepare('SELECT t.name FROM tags t JOIN trip_tags tt ON tt.tag_id = t.id WHERE tt.trip_id = ? ORDER BY t.name')
      .all(tripId) as { name: string }[]
  ).map((r) => r.name)
}

/** 覆盖式设置旅行标签 */
export function setTagsOfTrip(tripId: string, tags: string[]): void {
  const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING')
  const link = db.prepare('INSERT OR IGNORE INTO trip_tags (trip_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE name = ?))')
  const tx = db.transaction((names: string[]) => {
    db.prepare('DELETE FROM trip_tags WHERE trip_id = ?').run(tripId)
    for (const name of names) {
      const trimmed = name.trim()
      if (!trimmed) continue
      insertTag.run(trimmed)
      link.run(tripId, trimmed)
    }
  })
  tx(tags)
}

export function allTags(): string[] {
  return (db.prepare('SELECT name FROM tags ORDER BY name').all() as { name: string }[]).map(
    (r) => r.name,
  )
}

// ---------- photos ----------

interface PhotoRow {
  id: string
  trip_id: string
  file_name: string
  rel_path: string
  type: string
  caption: string | null
  width: number | null
  height: number | null
  thumb_status: string | null
  taken_at: number | null
}

function rowToPhoto(r: PhotoRow, albumId: string, isCover: boolean): PhotoDTO {
  const encoded = encodeURIComponent(r.rel_path)
  return {
    id: r.id,
    tripId: r.trip_id,
    fileName: r.file_name,
    relPath: r.rel_path,
    type: r.type as PhotoType,
    caption: r.caption ?? '',
    width: r.width,
    height: r.height,
    thumbStatus: (r.thumb_status ?? 'pending') as ThumbStatus,
    takenAt: r.taken_at,
    isCover,
    mediaUrl: `gallery-media://m/${albumId}/${encoded}`,
    thumbUrl: r.thumb_status === 'ready' ? `gallery-media://t/${r.id}.webp` : '',
  }
}

export function getPhotoRow(id: string): (PhotoDTO & { albumId: string }) | null {
  const r = db
    .prepare(
      'SELECT p.*, t.album_id AS album_id, t.cover_photo_id AS _cover FROM photos p JOIN trips t ON t.id = p.trip_id WHERE p.id = ?',
    )
    .get(id) as (PhotoRow & { album_id: string; _cover: string | null }) | undefined
  if (!r) return null
  const dto = rowToPhoto(r, r.album_id, r._cover === r.id)
  return { ...dto, albumId: r.album_id }
}

/** 大小写不敏感按文件名取照片 id */
export function getPhotoIdByTripAndName(tripId: string, fileName: string): string | null {
  const r = db
    .prepare('SELECT id FROM photos WHERE trip_id = ? AND lower(file_name) = lower(?)')
    .get(tripId, fileName) as { id: string } | undefined
  return r?.id ?? null
}

export function listPhotosOfTrip(tripId: string, albumId: string, coverPhotoId: string | null): PhotoDTO[] {
  return (
    db.prepare('SELECT * FROM photos WHERE trip_id = ? ORDER BY rowid').all(tripId) as PhotoRow[]
  ).map((r) => rowToPhoto(r, albumId, coverPhotoId === r.id))
}

export interface NewPhotoRecord {
  id: string
  tripId: string
  fileName: string
  relPath: string
  type: PhotoType
  caption: string
  takenAt: number
}

export function insertPhotoRow(p: NewPhotoRecord): void {
  db.prepare(
    `INSERT INTO photos (id, trip_id, file_name, rel_path, type, caption, taken_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(p.id, p.tripId, p.fileName, p.relPath, p.type, p.caption, p.takenAt)
}

export function listPhotoFilesOfTrip(
  tripId: string,
): { id: string; fileName: string; takenAt: number | null; thumbStatus: string }[] {
  return db
    .prepare(
      'SELECT id, file_name AS fileName, taken_at AS takenAt, thumb_status AS thumbStatus FROM photos WHERE trip_id = ?',
    )
    .all(tripId) as {
    id: string
    fileName: string
    takenAt: number | null
    thumbStatus: string
  }[]
}

export function updatePhotoTakenAt(id: string, takenAt: number): void {
  db.prepare('UPDATE photos SET taken_at = ?, thumb_status = ? WHERE id = ?').run(takenAt, 'pending', id)
}

export function deletePhotoRow(id: string): void {
  db.prepare('DELETE FROM photos WHERE id = ?').run(id)
}

export function setPhotoCaption(id: string, caption: string): void {
  db.prepare('UPDATE photos SET caption = ? WHERE id = ?').run(caption, id)
}

export function setPhotoThumbStatus(id: string, status: ThumbStatus): void {
  db.prepare('UPDATE photos SET thumb_status = ? WHERE id = ?').run(status, id)
}

export function setPhotoDimensions(id: string, width: number, height: number): void {
  db.prepare('UPDATE photos SET width = ?, height = ? WHERE id = ?').run(width, height, id)
}

export function listPendingThumbPhotos(albumId: string): (PhotoDTO & { albumId: string })[] {
  const rows = db
    .prepare(
      `SELECT p.*, t.album_id AS album_id, t.cover_photo_id AS _cover
       FROM photos p JOIN trips t ON t.id = p.trip_id
       WHERE t.album_id = ? AND p.thumb_status = 'pending'
       ORDER BY p.rowid`,
    )
    .all(albumId) as (PhotoRow & { album_id: string; _cover: string | null })[]
  return rows.map((r) => ({ ...rowToPhoto(r, r.album_id, r._cover === r.id), albumId: r.album_id }))
}

export function countPendingThumbs(albumId: string): number {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM photos p JOIN trips t ON t.id = p.trip_id
       WHERE t.album_id = ? AND p.thumb_status = 'pending'`,
    )
    .get(albumId) as { n: number }
  return r.n
}

// ---------- stats ----------

export function getStats(): { albums: number; trips: number; photos: number; storageBytes: number } {
  const a = db.prepare('SELECT COUNT(*) AS n FROM albums').get() as { n: number }
  const t = db.prepare('SELECT COUNT(*) AS n FROM trips').get() as { n: number }
  const p = db.prepare('SELECT COUNT(*) AS n FROM photos').get() as { n: number }
  // 存储占用：缩略图缓存 + 数据库文件
  let storageBytes = 0
  try {
    const { statSync, readdirSync } = require('fs') as typeof import('fs')
    storageBytes = statSync(join(app.getPath('userData'), 'gallery.db')).size
    const thumbDir = join(app.getPath('userData'), 'thumbnails')
    for (const f of readdirSync(thumbDir)) {
      storageBytes += statSync(join(thumbDir, f)).size
    }
  } catch {
    // 忽略统计失败
  }
  return { albums: a.n, trips: t.n, photos: p.n, storageBytes }
}
