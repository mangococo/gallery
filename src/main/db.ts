import Database from 'better-sqlite3'
import { app } from 'electron'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { normalizeTagNames } from '../shared/tags'
import { needsTripsRebuild, rebuildTripsWithoutTableUnique } from './services/migrations'
import { collectMatches, compareHits, rankOf } from '../shared/search'
import type { Album, PhotoDTO, PhotoType, SearchHit, SearchMatchIn, ThumbStatus, TripDTO } from '../shared/types'

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

/**
 * 基线建表（幂等，覆盖全新数据库）。
 * v0.10 起 photos.file_mtime 承担文件对账职责（taken_at 改存 EXIF 拍摄时间，只管展示）。
 * v0.12 起回收站：trips/photos 软删除（deleted_at 非空即回收站中）；
 * 旅行的 (album_id, folder_name) 唯一性只约束未删除行（partial unique index）——
 * 同名旅行允许与回收站中的旅行共存，恢复时再去重。
 */
const BASELINE_SQL = `
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
    deleted_at INTEGER
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
    taken_at INTEGER,
    file_mtime INTEGER,
    favorite INTEGER DEFAULT 0,
    gps_lat REAL,
    gps_lon REAL,
    deleted_at INTEGER
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

  CREATE TABLE IF NOT EXISTS photo_tags (
    photo_id TEXT REFERENCES photos(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (photo_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_photos_trip ON photos(trip_id);
  CREATE INDEX IF NOT EXISTS idx_trip_tags_tag ON trip_tags(tag_id);
  CREATE INDEX IF NOT EXISTS idx_photo_tags_tag ON photo_tags(tag_id);
  /* deleted_at 相关索引（partial unique uq_trips_live_folder 等）在 v4 迁移里建：
     存量库走到 BASELINE_SQL 时列还没补上，索引必须等 v4 加列后再创建 */
`

/**
 * user_version pragma 迁移：
 * - 全新库：基线建表（已含 file_mtime/favorite/photo_tags/deleted_at/partial unique）→ 逐版迁移全为空操作 → 置 user_version
 * - v0.9 存量库：v1 给 photos 补 file_mtime 列并把 taken_at（即当时的 mtime）回填进去
 * - v0.10 存量库：v2 给 photos 补 favorite 列（默认 0，无需回填）；photo_tags 建表在基线 SQL 里幂等完成
 * - v0.11 存量库：v3 给 photos 补 GPS 列
 * - v0.12 回收站：v4 给 trips/photos 补 deleted_at 列；trips 表若还带表级 UNIQUE(album_id, folder_name)
 *   则整表重建去掉（唯一性改由 partial unique index 只约束未删除行，见 BASELINE_SQL 注释）
 */
function migrate(): void {
  const version = db.pragma('user_version', { simple: true }) as number
  db.exec(BASELINE_SQL)

  // v4 的 trips 表重建必须发生在任何事务之外（见 rebuildTripsWithoutTableUnique 的
  // inTransaction 守卫）。幂等：重建过一次后建表 SQL 不再含表级 UNIQUE，不会重跑；
  // 重建成功但后续步骤失败时，version 仍未写入，下次启动会跳过重建继续补齐其余步骤
  if (version < 4) {
    const createSql =
      (
        db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'trips'")
          .get() as { sql: string } | undefined
      )?.sql ?? ''
    if (needsTripsRebuild(createSql)) {
      rebuildTripsWithoutTableUnique(db)
    }
  }

  // 事务保证 ALTER/回填/版本号同生共死（中途断电不会留下「列已加但版本未写」的中间态；
  // 各步本身也按列存在性幂等，双保险）
  const applyMigrations = db.transaction(() => {
    if (version < 1) {
      const cols = db.pragma('table_info(photos)') as { name: string }[]
      if (!cols.some((c) => c.name === 'file_mtime')) {
        db.exec('ALTER TABLE photos ADD COLUMN file_mtime INTEGER')
        // 存量 taken_at 一直是文件 mtime，直接平移给 file_mtime 承担对账职责
        db.exec('UPDATE photos SET file_mtime = taken_at WHERE file_mtime IS NULL')
      }
      db.pragma('user_version = 1')
    }

    if (version < 2) {
      const cols = db.pragma('table_info(photos)') as { name: string }[]
      if (!cols.some((c) => c.name === 'favorite')) {
        db.exec('ALTER TABLE photos ADD COLUMN favorite INTEGER DEFAULT 0')
      }
      db.pragma('user_version = 2')
    }

    if (version < 3) {
      const cols = db.pragma('table_info(photos)') as { name: string }[]
      if (!cols.some((c) => c.name === 'gps_lat')) {
        db.exec('ALTER TABLE photos ADD COLUMN gps_lat REAL')
        db.exec('ALTER TABLE photos ADD COLUMN gps_lon REAL')
      }
      db.pragma('user_version = 3')
    }

    if (version < 4) {
      const photoCols = db.pragma('table_info(photos)') as { name: string }[]
      if (!photoCols.some((c) => c.name === 'deleted_at')) {
        db.exec('ALTER TABLE photos ADD COLUMN deleted_at INTEGER')
      }
      // trips 的表级 UNIQUE 重建已在事务外完成（或在全新库中本就不需要）；
      // 这里只补 deleted_at 列（重建后的表已含，幂等）与索引
      const tripCols = db.pragma('table_info(trips)') as { name: string }[]
      if (!tripCols.some((c) => c.name === 'deleted_at')) {
        db.exec('ALTER TABLE trips ADD COLUMN deleted_at INTEGER')
      }
      db.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_trips_live_folder ON trips(album_id, folder_name) WHERE deleted_at IS NULL',
      )
      db.exec('CREATE INDEX IF NOT EXISTS idx_trips_trashed ON trips(deleted_at) WHERE deleted_at IS NOT NULL')
      db.exec('CREATE INDEX IF NOT EXISTS idx_photos_trashed ON photos(deleted_at) WHERE deleted_at IS NOT NULL')
      db.pragma('user_version = 4')
    }
  })
  applyMigrations()
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
  deleted_at: number | null
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
    // DB 不落盘此状态：IPC 层在 list/get 时按磁盘实时校对覆盖（'ok' 只是占位）
    status: 'ok',
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
  const r = db.prepare('SELECT * FROM trips WHERE id = ? AND deleted_at IS NULL').get(id) as TripRow | undefined
  return r ? rowToTrip(r) : null
}

export function getTripIdByFolder(albumId: string, folderName: string): string | null {
  const r = db
    .prepare('SELECT id FROM trips WHERE album_id = ? AND folder_name = ? AND deleted_at IS NULL')
    .get(albumId, folderName) as { id: string } | undefined
  return r?.id ?? null
}

export function listTripRows(albumId: string): Omit<TripDTO, 'tags' | 'photos'>[] {
  return (
    db
      .prepare(
        `SELECT * FROM trips WHERE album_id = ? AND deleted_at IS NULL
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

/** 覆盖式设置旅行标签（规范化：trim、去空、去重） */
export function setTagsOfTrip(tripId: string, tags: string[]): void {
  const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING')
  const link = db.prepare('INSERT OR IGNORE INTO trip_tags (trip_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE name = ?))')
  const tx = db.transaction((names: string[]) => {
    db.prepare('DELETE FROM trip_tags WHERE trip_id = ?').run(tripId)
    for (const name of names) {
      insertTag.run(name)
      link.run(tripId, name)
    }
  })
  tx(normalizeTagNames(tags))
}

export function getTagsOfPhoto(photoId: string): string[] {
  return (
    db
      .prepare(
        'SELECT t.name FROM tags t JOIN photo_tags pt ON pt.tag_id = t.id WHERE pt.photo_id = ? ORDER BY t.name',
      )
      .all(photoId) as { name: string }[]
  ).map((r) => r.name)
}

/** 覆盖式设置照片标签（与旅行标签共用 tags 表） */
export function setTagsOfPhoto(photoId: string, tags: string[]): void {
  const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING')
  const link = db.prepare('INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE name = ?))')
  const tx = db.transaction((names: string[]) => {
    db.prepare('DELETE FROM photo_tags WHERE photo_id = ?').run(photoId)
    for (const name of names) {
      insertTag.run(name)
      link.run(photoId, name)
    }
  })
  tx(normalizeTagNames(tags))
}

/** 全部已有标签，旅行+照片合计用量降序（联想选择用） */
export function allTags(): string[] {
  return (
    db
      .prepare(
        `SELECT t.name FROM tags t
         LEFT JOIN trip_tags tt ON tt.tag_id = t.id
         LEFT JOIN trips tr ON tr.id = tt.trip_id AND tr.deleted_at IS NULL
         LEFT JOIN photo_tags pt ON pt.tag_id = t.id
         LEFT JOIN photos ph ON ph.id = pt.photo_id AND ph.deleted_at IS NULL
         GROUP BY t.id
         ORDER BY (COUNT(DISTINCT tr.id) + COUNT(DISTINCT ph.id)) DESC, t.name`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name)
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
  file_mtime: number | null
  favorite: number | null
  gps_lat: number | null
  gps_lon: number | null
  deleted_at: number | null
}

function rowToPhoto(r: PhotoRow, albumId: string, isCover: boolean, tags: string[] = []): PhotoDTO {
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
    favorite: !!r.favorite,
    tags,
    gpsLat: r.gps_lat,
    gpsLon: r.gps_lon,
    mediaUrl: `gallery-media://m/${albumId}/${encoded}`,
    thumbUrl: r.thumb_status === 'ready' ? `gallery-media://t/${r.id}.webp` : '',
  }
}

export function getPhotoRow(id: string): (PhotoDTO & { albumId: string }) | null {
  const r = db
    .prepare(
      'SELECT p.*, t.album_id AS album_id, t.cover_photo_id AS _cover FROM photos p JOIN trips t ON t.id = p.trip_id WHERE p.id = ? AND p.deleted_at IS NULL',
    )
    .get(id) as (PhotoRow & { album_id: string; _cover: string | null }) | undefined
  if (!r) return null
  const dto = rowToPhoto(r, r.album_id, r._cover === r.id, getTagsOfPhoto(id))
  return { ...dto, albumId: r.album_id }
}

/** 大小写不敏感按文件名取照片 id */
export function getPhotoIdByTripAndName(tripId: string, fileName: string): string | null {
  const r = db
    .prepare('SELECT id FROM photos WHERE trip_id = ? AND lower(file_name) = lower(?) AND deleted_at IS NULL')
    .get(tripId, fileName) as { id: string } | undefined
  return r?.id ?? null
}

/** 旅行内全部照片，批量带出标签（一次 JOIN，避免 N+1） */
export function listPhotosOfTrip(tripId: string, albumId: string, coverPhotoId: string | null): PhotoDTO[] {
  const tagRows = db
    .prepare(
      `SELECT pt.photo_id AS photoId, g.name AS name
       FROM photo_tags pt
       JOIN tags g ON g.id = pt.tag_id
       WHERE pt.photo_id IN (SELECT id FROM photos WHERE trip_id = ? AND deleted_at IS NULL)
       ORDER BY g.name`,
    )
    .all(tripId) as { photoId: string; name: string }[]
  const tagsByPhoto = new Map<string, string[]>()
  for (const r of tagRows) {
    const list = tagsByPhoto.get(r.photoId) ?? []
    list.push(r.name)
    tagsByPhoto.set(r.photoId, list)
  }
  return (db.prepare('SELECT * FROM photos WHERE trip_id = ? AND deleted_at IS NULL ORDER BY rowid').all(tripId) as PhotoRow[]).map(
    (r) => rowToPhoto(r, albumId, coverPhotoId === r.id, tagsByPhoto.get(r.id) ?? []),
  )
}

export interface NewPhotoRecord {
  id: string
  tripId: string
  fileName: string
  relPath: string
  type: PhotoType
  caption: string
  takenAt: number
  /** 文件 mtime，对账用（taken_at 存 EXIF 拍摄时间，二者解耦） */
  fileMtime: number
  /** EXIF GPS（无则为 null） */
  gpsLat: number | null
  gpsLon: number | null
}

export function insertPhotoRow(p: NewPhotoRecord): void {
  db.prepare(
    `INSERT INTO photos (id, trip_id, file_name, rel_path, type, caption, taken_at, file_mtime, gps_lat, gps_lon)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(p.id, p.tripId, p.fileName, p.relPath, p.type, p.caption, p.takenAt, p.fileMtime, p.gpsLat, p.gpsLon)
}

export function listPhotoFilesOfTrip(
  tripId: string,
): { id: string; fileName: string; fileMtime: number | null }[] {
  return db
    .prepare(
      'SELECT id, file_name AS fileName, file_mtime AS fileMtime FROM photos WHERE trip_id = ? AND deleted_at IS NULL',
    )
    .all(tripId) as {
    id: string
    fileName: string
    fileMtime: number | null
  }[]
}

/** 文件被替换：更新拍摄时间/GPS/file_mtime，缩略图重新生成 */
export function updatePhotoFileMeta(
  id: string,
  takenAt: number,
  fileMtime: number,
  gps: { lat: number; lon: number } | null,
): void {
  db.prepare(
    'UPDATE photos SET taken_at = ?, file_mtime = ?, gps_lat = ?, gps_lon = ?, thumb_status = ? WHERE id = ?',
  ).run(takenAt, fileMtime, gps?.lat ?? null, gps?.lon ?? null, 'pending', id)
}

/** 仅更新拍摄时间（EXIF 回填用，不动缩略图状态） */
export function updatePhotoTakenAtOnly(id: string, takenAt: number): void {
  db.prepare('UPDATE photos SET taken_at = ? WHERE id = ?').run(takenAt, id)
}

/** 旅行内最早拍摄时间（旅行开始日期推断用）；无照片返回 null */
export function getEarliestTakenAtOfTrip(tripId: string): number | null {
  const r = db
    .prepare('SELECT MIN(taken_at) AS min FROM photos WHERE trip_id = ? AND taken_at IS NOT NULL AND deleted_at IS NULL')
    .get(tripId) as { min: number | null }
  return r.min
}

/** 未填开始日期的旅行（回填后推断日期用） */
export function listTripsWithEmptyStartDate(): { id: string; albumId: string }[] {
  return db
    .prepare(
      "SELECT id, album_id AS albumId FROM trips WHERE start_date IS NULL OR start_date = ''",
    )
    .all() as { id: string; albumId: string }[]
}

/** EXIF 一次性回填：全库照片 + 所属相册根目录 */
export function listPhotosForExifBackfill(): {
  id: string
  relPath: string
  type: string
  albumPath: string
}[] {
  return db
    .prepare(
      `SELECT p.id, p.rel_path AS relPath, p.type, a.path AS albumPath
       FROM photos p JOIN trips t ON t.id = p.trip_id JOIN albums a ON a.id = t.album_id
       WHERE p.deleted_at IS NULL`,
    )
    .all() as { id: string; relPath: string; type: string; albumPath: string }[]
}

/** GPS 一次性回填：尚无坐标的图片（v3 之前入库的照片） */
export function listPhotosForGpsBackfill(): {
  id: string
  relPath: string
  albumPath: string
}[] {
  return db
    .prepare(
      `SELECT p.id, p.rel_path AS relPath, a.path AS albumPath
       FROM photos p JOIN trips t ON t.id = p.trip_id JOIN albums a ON a.id = t.album_id
       WHERE p.gps_lat IS NULL AND p.type = 'image' AND p.deleted_at IS NULL`,
    )
    .all() as { id: string; relPath: string; albumPath: string }[]
}

export function updatePhotoGps(id: string, lat: number, lon: number): void {
  db.prepare('UPDATE photos SET gps_lat = ?, gps_lon = ? WHERE id = ?').run(lat, lon, id)
}

export function deletePhotoRow(id: string): void {
  db.prepare('DELETE FROM photos WHERE id = ?').run(id)
}

export interface PhotoLocationUpdate {
  id: string
  tripId: string
  fileName: string
  relPath: string
}

/** 批量移动照片归属：单事务更新 trip_id/file_name/rel_path（缩略图按 id 存放，无需动） */
export function updatePhotoLocations(records: PhotoLocationUpdate[]): void {
  const tx = db.transaction((rows: PhotoLocationUpdate[]) => {
    const stmt = db.prepare(
      'UPDATE photos SET trip_id = ?, file_name = ?, rel_path = ? WHERE id = ?',
    )
    for (const r of rows) stmt.run(r.tripId, r.fileName, r.relPath, r.id)
  })
  tx(records)
}

export function setPhotoCaption(id: string, caption: string): void {
  db.prepare('UPDATE photos SET caption = ? WHERE id = ?').run(caption, id)
}

/** 只填空图注：.settings.json 修复通道用，绝不覆盖已有/用户编辑过的图注 */
export function fillPhotoCaptionIfEmpty(tripId: string, fileName: string, caption: string): void {
  db.prepare(
    "UPDATE photos SET caption = ? WHERE trip_id = ? AND lower(file_name) = lower(?) AND (caption IS NULL OR caption = '') AND deleted_at IS NULL",
  ).run(caption, tripId, fileName)
}

export function setPhotoFavorite(id: string, favorite: boolean): void {
  db.prepare('UPDATE photos SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, id)
}

export function setPhotoThumbStatus(id: string, status: ThumbStatus): void {
  db.prepare('UPDATE photos SET thumb_status = ? WHERE id = ?').run(status, id)
}

/**
 * 缩略图批量落库（#4）：就绪（含宽高）与失败一次事务写入，
 * 替代每张两条同步 UPDATE——大批量生成时显著减少 sqlite 写放大。
 */
export function markThumbResults(
  ready: { id: string; width: number; height: number }[],
  failed: string[],
): void {
  if (ready.length > 0) {
    const tx = db.transaction((items: { id: string; width: number; height: number }[]) => {
      const stmt = db.prepare('UPDATE photos SET thumb_status = ?, width = ?, height = ? WHERE id = ?')
      for (const it of items) stmt.run('ready', it.width, it.height, it.id)
    })
    tx(ready)
  }
  if (failed.length > 0) {
    const tx = db.transaction((ids: string[]) => {
      const stmt = db.prepare("UPDATE photos SET thumb_status = 'failed' WHERE id = ?")
      for (const id of ids) stmt.run(id)
    })
    tx(failed)
  }
}

export function setPhotoDimensions(id: string, width: number, height: number): void {
  db.prepare('UPDATE photos SET width = ?, height = ? WHERE id = ?').run(width, height, id)
}

export function listPendingThumbPhotos(albumId: string): (PhotoDTO & { albumId: string })[] {
  const rows = db
    .prepare(
      `SELECT p.*, t.album_id AS album_id, t.cover_photo_id AS _cover
       FROM photos p JOIN trips t ON t.id = p.trip_id
       WHERE t.album_id = ? AND p.thumb_status = 'pending' AND p.deleted_at IS NULL
       ORDER BY p.rowid`,
    )
    .all(albumId) as (PhotoRow & { album_id: string; _cover: string | null })[]
  return rows.map((r) => ({ ...rowToPhoto(r, r.album_id, r._cover === r.id), albumId: r.album_id }))
}

export function countPendingThumbs(albumId: string): number {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n FROM photos p JOIN trips t ON t.id = p.trip_id
       WHERE t.album_id = ? AND p.thumb_status = 'pending' AND p.deleted_at IS NULL`,
    )
    .get(albumId) as { n: number }
  return r.n
}

// ---------- 回收站（软删除） ----------

/** 按 id 取旅行行，含回收站中的（删除/恢复流程用，业务视图一律走 getTripRow）；deletedAt 供恢复流程区分时间戳 */
export function getTripRowIncludingTrashed(
  id: string,
): (Omit<TripDTO, 'tags' | 'photos'> & { deletedAt: number | null }) | null {
  const r = db.prepare('SELECT * FROM trips WHERE id = ?').get(id) as TripRow | undefined
  return r ? { ...rowToTrip(r), deletedAt: r.deleted_at ?? null } : null
}

/** 按 id 取照片行，含回收站中的（恢复/彻底删除流程用）；业务视图一律走 getPhotoRow */
export function getPhotoRowIncludingTrashed(
  id: string,
): (PhotoRow & { albumId: string }) | null {
  const r = db
    .prepare(
      'SELECT p.*, t.album_id AS albumId FROM photos p JOIN trips t ON t.id = p.trip_id WHERE p.id = ?',
    )
    .get(id) as (PhotoRow & { albumId: string }) | undefined
  return r ?? null
}

/** 文件名占用的旅行行（含回收站）：新建旅行/恢复旅行的重名判定用 */
export function getAnyTripIdByFolder(albumId: string, folderName: string): string | null {
  const r = db
    .prepare('SELECT id FROM trips WHERE album_id = ? AND folder_name = ?')
    .get(albumId, folderName) as { id: string } | undefined
  return r?.id ?? null
}

/** 整个旅行（含其下全部未删除照片）标记进入回收站；deleted_at 取同一时间戳，恢复时凭它区分「随旅行删除」与「被单独删除」的照片 */
export function markTripTrashed(tripId: string, ts: number): void {
  const tx = db.transaction(() => {
    db.prepare('UPDATE trips SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(ts, tripId)
    db.prepare('UPDATE photos SET deleted_at = ? WHERE trip_id = ? AND deleted_at IS NULL').run(ts, tripId)
  })
  tx()
}

export function markPhotoTrashed(photoId: string, ts: number): void {
  db.prepare('UPDATE photos SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(ts, photoId)
}

/** 旅行出回收站：清自身与「随旅行一起删除」（时间戳相同）的照片；folder_name 同步为去重后的新名。返回随旅行复活的照片数 */
export function restoreTripRows(tripId: string, trashTs: number, folderName: string): number {
  let revived = 0
  const tx = db.transaction(() => {
    db.prepare('UPDATE trips SET deleted_at = NULL, folder_name = ?, updated_at = ? WHERE id = ?').run(
      folderName,
      Date.now(),
      tripId,
    )
    const r = db
      .prepare('UPDATE photos SET deleted_at = NULL WHERE trip_id = ? AND deleted_at = ?')
      .run(tripId, trashTs)
    revived = r.changes
    // rel_path 以 folder_name 为前缀：旅行改名时照片的相对路径跟着改
    db.prepare("UPDATE photos SET rel_path = ? || '/' || file_name WHERE trip_id = ?").run(
      folderName,
      tripId,
    )
  })
  tx()
  return revived
}

/** 恢复一张被单独删除的照片（所属旅行已在业务视图中的场景） */
export function restorePhotoRow(photoId: string): void {
  db.prepare('UPDATE photos SET deleted_at = NULL WHERE id = ?').run(photoId)
}

/** 恢复时目标重名（同旅行内已被重新导入同名文件）→ 更新文件名与相对路径 */
export function updatePhotoFileName(id: string, fileName: string, relPath: string): void {
  db.prepare('UPDATE photos SET file_name = ?, rel_path = ? WHERE id = ?').run(fileName, relPath, id)
}

/** 恢复旅行时若目标文件夹名变化，需要回写（照片 rel_path 由 restoreTripRows 统一重算） */
export function setTripFolderName(id: string, folderName: string): void {
  db.prepare('UPDATE trips SET folder_name = ? WHERE id = ?').run(folderName, id)
}

/** 旅行下全部照片行（含回收站中的）：彻底删除时的文件/缩略图清理枚举用 */
export function listPhotoRowsOfTripIncludingTrashed(tripId: string): PhotoRow[] {
  return db.prepare('SELECT * FROM photos WHERE trip_id = ?').all(tripId) as PhotoRow[]
}

export function hardDeletePhotoRows(ids: string[]): void {
  const tx = db.transaction((rowIds: string[]) => {
    const stmt = db.prepare('DELETE FROM photos WHERE id = ?')
    for (const id of rowIds) stmt.run(id)
  })
  tx(ids)
}

interface TrashedTripRow {
  id: string
  title: string
  folder_name: string
  album_id: string
  album_name: string
  cover_photo_id: string | null
  deleted_at: number
  photo_count: number
}

export function listTrashedTripRows(): TrashedTripRow[] {
  return db
    .prepare(
      `SELECT tr.id, tr.title, tr.folder_name, tr.album_id AS album_id, a.name AS album_name,
              tr.cover_photo_id, tr.deleted_at,
              (SELECT COUNT(*) FROM photos p WHERE p.trip_id = tr.id AND p.deleted_at = tr.deleted_at) AS photo_count
       FROM trips tr JOIN albums a ON a.id = tr.album_id
       WHERE tr.deleted_at IS NOT NULL
       ORDER BY tr.deleted_at DESC`,
    )
    .all() as TrashedTripRow[]
}

interface TrashedPhotoRow {
  id: string
  file_name: string
  rel_path: string
  type: string
  thumb_status: string | null
  trip_id: string
  trip_title: string
  trip_folder_name: string
  trip_deleted_at: number | null
  album_id: string
  album_name: string
  deleted_at: number
}

export function listTrashedPhotoRows(): TrashedPhotoRow[] {
  return db
    .prepare(
      `SELECT p.id, p.file_name, p.rel_path, p.type, p.thumb_status, p.deleted_at,
              tr.id AS trip_id, tr.title AS trip_title, tr.folder_name AS trip_folder_name,
              tr.deleted_at AS trip_deleted_at,
              a.id AS album_id, a.name AS album_name
       FROM photos p
       JOIN trips tr ON tr.id = p.trip_id
       JOIN albums a ON a.id = tr.album_id
       WHERE p.deleted_at IS NOT NULL
         AND (tr.deleted_at IS NULL OR p.deleted_at != tr.deleted_at)
       ORDER BY p.deleted_at DESC`,
    )
    .all() as TrashedPhotoRow[]
}

/** 回收站项目数（侧栏角标用）。与回收站列表同口径：随旅行删除的照片并入旅行项，不单独计数 */
export function countTrashed(): number {
  const t = db.prepare('SELECT COUNT(*) AS n FROM trips WHERE deleted_at IS NOT NULL').get() as { n: number }
  const p = db
    .prepare(
      `SELECT COUNT(*) AS n FROM photos p JOIN trips tr ON tr.id = p.trip_id
       WHERE p.deleted_at IS NOT NULL AND (tr.deleted_at IS NULL OR p.deleted_at != tr.deleted_at)`,
    )
    .get() as { n: number }
  return t.n + p.n
}


// ---------- ⌘K 搜索 ----------

interface HitPhoto {
  id: string
  type: string
  relPath: string
  thumbStatus: string
  albumId: string
}

function hitThumbUrl(r: HitPhoto | undefined): string {
  if (!r) return ''
  if (r.thumbStatus === 'ready') return `gallery-media://t/${r.id}.webp`
  return r.type === 'image' ? `gallery-media://m/${r.albumId}/${encodeURIComponent(r.relPath)}` : ''
}

/**
 * ⌘K 旅行搜索：标题/描述/旅行标签/图注/照片标签（照片侧命中聚合到所属旅行）。
 * 选 LIKE 而非 FTS5：unicode61 分词器不切分中文（整段中文成一个 token，两字词搜不到），
 * trigram 分词又要求查询 ≥3 字符；旅行数量小，LIKE 扫描配合面板防抖足够。
 * 字段匹配在 JS 侧做（toLowerCase，Unicode 友好）；图注/照片标签命中在 SQL 侧筛
 * （LIKE 仅 ASCII 大小写不敏感，中文无大小写概念，行为一致）。
 */
export function searchTripHits(albumId: string, rawQ: string): SearchHit[] {
  const q = rawQ.trim()
  if (!q) return []
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

  const tripRows = listTripRows(albumId)

  const tagRows = db
    .prepare(
      `SELECT tt.trip_id AS tripId, g.name AS name
       FROM trip_tags tt
       JOIN tags g ON g.id = tt.tag_id
       JOIN trips tr ON tr.id = tt.trip_id
       WHERE tr.album_id = ?`,
    )
    .all(albumId) as { tripId: string; name: string }[]
  const tagsByTrip = new Map<string, string[]>()
  for (const r of tagRows) {
    const list = tagsByTrip.get(r.tripId) ?? []
    list.push(r.name)
    tagsByTrip.set(r.tripId, list)
  }

  const capRows = db
    .prepare(
      `SELECT p.trip_id AS tripId, p.id, p.type, p.rel_path AS relPath,
              p.thumb_status AS thumbStatus, p.caption, tr.album_id AS albumId
       FROM photos p
       JOIN trips tr ON tr.id = p.trip_id
       WHERE tr.album_id = ? AND p.deleted_at IS NULL AND p.caption LIKE ? ESCAPE '\\'
       ORDER BY p.rowid`,
    )
    .all(albumId, like) as (HitPhoto & { tripId: string; caption: string })[]
  const capByTrip = new Map<string, (typeof capRows)[number]>()
  for (const r of capRows) if (!capByTrip.has(r.tripId)) capByTrip.set(r.tripId, r)

  // 照片标签命中：同样聚合到所属旅行，命中照片可作缩略图候选
  const ptagRows = db
    .prepare(
      `SELECT p.trip_id AS tripId, p.id, p.type, p.rel_path AS relPath,
              p.thumb_status AS thumbStatus, tr.album_id AS albumId, g.name AS tagName
       FROM photo_tags pt
       JOIN tags g ON g.id = pt.tag_id
       JOIN photos p ON p.id = pt.photo_id
       JOIN trips tr ON tr.id = p.trip_id
       WHERE tr.album_id = ? AND p.deleted_at IS NULL AND g.name LIKE ? ESCAPE '\\'
       ORDER BY p.rowid`,
    )
    .all(albumId, like) as (HitPhoto & { tripId: string; tagName: string })[]
  const ptagByTrip = new Map<string, HitPhoto>()
  for (const r of ptagRows) if (!ptagByTrip.has(r.tripId)) ptagByTrip.set(r.tripId, r)

  const coverById = new Map<string, HitPhoto>()
  for (const t of tripRows) {
    if (!t.coverPhotoId || coverById.has(t.coverPhotoId)) continue
    const r = db
      .prepare(
        'SELECT p.id, p.type, p.rel_path AS relPath, p.thumb_status AS thumbStatus, t.album_id AS albumId FROM photos p JOIN trips t ON t.id = p.trip_id WHERE p.id = ? AND p.deleted_at IS NULL',
      )
      .get(t.coverPhotoId) as HitPhoto | undefined
    if (r) coverById.set(t.coverPhotoId, r)
  }

  const lowerQ = q.toLowerCase()
  const hits: { hit: SearchHit; rank: number }[] = []
  for (const t of tripRows) {
    const tags = tagsByTrip.get(t.id) ?? []
    const cap = capByTrip.get(t.id)
    const ptagHit = ptagByTrip.get(t.id)
    const matchedIn = collectMatches(
      t.title,
      t.description,
      tags,
      lowerQ,
      cap !== undefined,
      ptagHit !== undefined,
    )
    if (matchedIn.length === 0) continue

    const rank = rankOf(matchedIn)
    hits.push({
      rank,
      hit: {
        tripId: t.id,
        title: t.title,
        startDate: t.startDate,
        tags,
        matchedIn,
        description: t.description,
        sampleCaption: cap?.caption ?? null,
        thumbUrl:
          hitThumbUrl(cap) ||
          hitThumbUrl(ptagHit) ||
          hitThumbUrl(t.coverPhotoId ? coverById.get(t.coverPhotoId) : undefined),
      },
    })
  }
  hits.sort((a, b) =>
    compareHits({ rank: a.rank, startDate: a.hit.startDate }, { rank: b.rank, startDate: b.hit.startDate }),
  )
  return hits.slice(0, 50).map((h) => h.hit)
}

// ---------- stats ----------

export function getStats(): {
  albums: number
  trips: number
  photos: number
  storageBytes: number
  trash: number
} {
  const a = db.prepare('SELECT COUNT(*) AS n FROM albums').get() as { n: number }
  const t = db.prepare('SELECT COUNT(*) AS n FROM trips WHERE deleted_at IS NULL').get() as { n: number }
  const p = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE deleted_at IS NULL').get() as { n: number }
  // 存储占用：缩略图缓存 + 数据库文件
  let storageBytes = 0
  try {
    storageBytes = statSync(join(app.getPath('userData'), 'gallery.db')).size
    const thumbDir = join(app.getPath('userData'), 'thumbnails')
    for (const f of readdirSync(thumbDir)) {
      storageBytes += statSync(join(thumbDir, f)).size
    }
  } catch {
    // 忽略统计失败
  }
  return { albums: a.n, trips: t.n, photos: p.n, storageBytes, trash: countTrashed() }
}
