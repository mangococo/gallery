import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { needsTripsRebuild, rebuildTripsWithoutTableUnique } from '../src/main/services/migrations.ts'

/**
 * v4 迁移的 trips 表重建：对 v0.11 存量库（带表级 UNIQUE）做升级，
 * 验证数据保留、约束语义切换（live 唯一 / 回收站可同名）、FK 引用仍生效。
 * db.ts 依赖 electron 无法在测试进程加载，这里按 v3 真实 schema 复刻后调用同一迁移实现。
 */

const V3_SCHEMA = `
  CREATE TABLE albums (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    created_at INTEGER
  );
  CREATE TABLE trips (
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
  CREATE TABLE photos (
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
    gps_lon REAL
  );
  CREATE TABLE trip_tags (
    trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (trip_id, tag_id)
  );
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );
`

function makeV3Db(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(V3_SCHEMA)
  db.prepare(
    "INSERT INTO albums (id, name, path, status, created_at) VALUES ('a1', '演示', '/tmp/x', 'ok', 1)",
  ).run()
  db.prepare(
    "INSERT INTO trips (id, album_id, folder_name, title, created_at, updated_at) VALUES ('t1', 'a1', '京都', '京都秋日', 1, 1)",
  ).run()
  db.prepare(
    "INSERT INTO photos (id, trip_id, file_name, rel_path, type) VALUES ('p1', 't1', 'a.jpg', '京都/a.jpg', 'image')",
  ).run()
  return db
}

test('needsTripsRebuild：识别带表级 UNIQUE 的旧表，放过全新基线表', () => {
  assert.ok(needsTripsRebuild('CREATE TABLE trips (..., UNIQUE(album_id, folder_name))'))
  assert.ok(needsTripsRebuild('CREATE TABLE trips (..., UNIQUE( album_id, folder_name ))'))
  assert.equal(
    needsTripsRebuild('CREATE TABLE trips (id TEXT PRIMARY KEY, album_id TEXT, folder_name TEXT, deleted_at INTEGER)'),
    false,
  )
})

test('v4 重建：数据完整保留，deleted_at 列就位', () => {
  const db = makeV3Db()
  rebuildTripsWithoutTableUnique(db)
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get('t1') as any
  assert.equal(trip.folder_name, '京都')
  assert.equal(trip.title, '京都秋日')
  assert.equal(trip.deleted_at, null)
  // 照片行仍在，FK 引用按名字仍指向 trips
  const photo = db.prepare('SELECT p.*, t.title FROM photos p JOIN trips t ON t.id = p.trip_id WHERE p.id = ?').get('p1') as any
  assert.equal(photo.title, '京都秋日')
  // 新表有 deleted_at 列
  const cols = (db.pragma('table_info(trips)') as { name: string }[]).map((c) => c.name)
  assert.ok(cols.includes('deleted_at'))
  // 旧表级 UNIQUE 已不在建表 SQL 里
  const createSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='trips'").get() as any).sql
  assert.equal(needsTripsRebuild(createSql), false)
})

test('v4 重建后：live 同名唯一仍被 partial index 拦截（需配合迁移后建索引）', () => {
  const db = makeV3Db()
  rebuildTripsWithoutTableUnique(db)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_trips_live_folder ON trips(album_id, folder_name) WHERE deleted_at IS NULL')
  assert.throws(() => {
    db.prepare(
      "INSERT INTO trips (id, album_id, folder_name, title, created_at, updated_at, deleted_at) VALUES ('t2', 'a1', '京都', '重名', 2, 2, NULL)",
    ).run()
  })
})

test('v4 重建后：回收站中的同名旅行不挡新建/扫描重新入库', () => {
  const db = makeV3Db()
  rebuildTripsWithoutTableUnique(db)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_trips_live_folder ON trips(album_id, folder_name) WHERE deleted_at IS NULL')
  // 京都 进了回收站（deleted_at 非空）
  db.prepare("UPDATE trips SET deleted_at = 1000 WHERE id = 't1'").run()
  // 扫描重新发现同名文件夹 → 新旅行可正常入库（这是被 UNIQUE 挡住的旧行为）
  db.prepare(
    "INSERT INTO trips (id, album_id, folder_name, title, created_at, updated_at) VALUES ('t3', 'a1', '京都', '京都（新）', 3, 3)",
  ).run()
  const rows = db.prepare("SELECT id FROM trips WHERE folder_name = '京都'").all() as { id: string }[]
  assert.equal(rows.length, 2)
})

test('v4 重建后：旅行删除级联照片、照片删除置空封面引用（FK 语义不变）', () => {
  const db = makeV3Db()
  rebuildTripsWithoutTableUnique(db)
  db.prepare("UPDATE trips SET cover_photo_id = 'p1' WHERE id = 't1'").run()
  db.prepare("DELETE FROM photos WHERE id = 'p1'").run()
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get('t1') as any
  assert.equal(trip.cover_photo_id, null)
})
