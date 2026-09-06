import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TRIPS_DIR,
  PHOTOS_DIR,
  trashedTripDirRelPath,
  trashedTripFileRelPath,
  trashedPhotoFileRelPath,
  dedupeRestoreName,
} from '../src/main/services/trash-plan.ts'

test('旅行回收站槽位：以 tripId 为键（目录本体即文件夹）', () => {
  assert.equal(trashedTripDirRelPath('trip1'), `${TRIPS_DIR}/trip1`)
  assert.match(trashedTripDirRelPath('trip1'), /^\.gallery-trash\/trips\/trip1$/)
  // 槽位内的成员文件
  assert.equal(trashedTripFileRelPath('trip1', 'IMG_1.jpg'), `.gallery-trash/trips/trip1/IMG_1.jpg`)
})

test('单独删除媒体的槽位：photoId 键位，同名文件互不冲突', () => {
  const a = trashedPhotoFileRelPath('p1', 'IMG_1.jpg')
  const b = trashedPhotoFileRelPath('p2', 'IMG_1.jpg')
  assert.equal(a, `.gallery-trash/photos/p1/IMG_1.jpg`)
  assert.notEqual(a, b)
})

test('照片物理位置双探测约定：单独删除在照片槽位，随旅行删除在旅行目录', () => {
  // 单独删除（即使旅行后来也进回收站）→ 照片槽位
  assert.equal(trashedPhotoFileRelPath('p1', 'IMG_1.jpg'), `.gallery-trash/photos/p1/IMG_1.jpg`)
  // 随旅行文件夹整体删除 → 旅行目录内
  assert.equal(trashedTripFileRelPath('t1', 'IMG_1.jpg'), `.gallery-trash/trips/t1/IMG_1.jpg`)
})

test('回收站目录以点开头：扫描与 watcher 天然忽略（删除后不会被重新入库）', () => {
  const p = trashedPhotoFileRelPath('p1', 'a.jpg')
  const root = p.split('/')[0]
  assert.ok(root.startsWith('.'))
  assert.ok(trashedTripDirRelPath('t').split('/')[0].startsWith('.'))
})

test('dedupeRestoreName：不占用返回原名', () => {
  assert.equal(dedupeRestoreName('京都', () => false), '京都')
})

test('dedupeRestoreName：占用时按「name (2)」递增，与建旅行同一约定', () => {
  const taken = new Set(['京都', '京都 (2)', '京都 (3)'])
  assert.equal(dedupeRestoreName('京都', (n) => taken.has(n)), '京都 (4)')
})

test('dedupeRestoreName：恢复目标与回收站中的另一旅行同名也不冲突（槽位按 id 存放）', () => {
  // 占用判定由调用方注入（磁盘存在或记录占用），这里验证纯逻辑能吃下任意判定
  let calls = 0
  const name = dedupeRestoreName('大理', (n) => {
    calls++
    return n === '大理'
  })
  assert.equal(name, '大理 (2)')
  assert.equal(calls, 2)
})
