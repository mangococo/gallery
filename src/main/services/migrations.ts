import type Database from 'better-sqlite3'

/**
 * DB v4（回收站）的 trips 表重建：去掉表级 UNIQUE(album_id, folder_name)。
 * SQLite 不支持 DROP CONSTRAINT，只能 建新表→拷贝→删旧表→改名。
 * 唯一性改由 partial unique index（uq_trips_live_folder，WHERE deleted_at IS NULL）承担：
 * 同名旅行允许与回收站中的旅行共存，恢复/新建时再做去重。
 *
 * 抽成独立模块是为了 node --test 可直测（db.ts 依赖 electron.app 无法在测试进程加载）。
 */

export const TRIPS_V4_CREATE = `
  CREATE TABLE trips_v4 (
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
  )
`

/** 旧表建表 SQL 是否还带表级 UNIQUE(album_id, folder_name)（全新库的基线表已无该约束） */
export function needsTripsRebuild(createSql: string): boolean {
  return /UNIQUE\s*\(\s*album_id\s*,\s*folder_name\s*\)/i.test(createSql)
}

/**
 * 执行重建。全程 foreign_keys=OFF（photos/trip_tags 按「名字」引用 trips，
 * 旧表删除+新表顶名后引用依旧成立），PRAGMA 不能在事务内生效，故放事务外；
 * 数据拷贝本身在事务里，断电不留半张表。
 */
export function rebuildTripsWithoutTableUnique(db: Database.Database): void {
  // 硬守卫：PRAGMA foreign_keys 在事务（含 SAVEPOINT）内是 no-op，若在此状态下
  // DROP TABLE trips，隐式 DELETE 会带着 ON DELETE CASCADE 清空 photos 与
  // trip_tags/photo_tags（封面随 ON DELETE SET NULL 置空）——数据全灭。
  // 必须在任何事务之外调用。
  if (db.inTransaction) {
    throw new Error('trips 表重建必须在事务外执行（PRAGMA foreign_keys 在事务内不生效，会导致级联清库）')
  }
  db.pragma('foreign_keys = OFF')
  try {
    const tx = db.transaction(() => {
      db.exec(TRIPS_V4_CREATE)
      db.exec(`
        INSERT INTO trips_v4 (id, album_id, folder_name, title, description, start_date, end_date, is_favorite, cover_photo_id, created_at, updated_at)
          SELECT id, album_id, folder_name, title, description, start_date, end_date, is_favorite, cover_photo_id, created_at, updated_at FROM trips;
        DROP TABLE trips;
        ALTER TABLE trips_v4 RENAME TO trips;
      `)
    })
    tx()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
