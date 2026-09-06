import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collisionSafeDestName,
  planCoverReassignment,
  validateMovePhotos,
  type MovePhotoFact,
  type SourceTripFact,
} from '../src/main/services/move-plan.ts'

function fact(partial: Partial<MovePhotoFact> & { id: string }): MovePhotoFact {
  return {
    albumId: 'album-1',
    tripId: 'trip-a',
    fileName: `${partial.id}.jpg`,
    relPath: `trip-a/${partial.id}.jpg`,
    ...partial,
  }
}

test('validateMovePhotos：同旅行目标静默跳过、重复 id 去重', () => {
  const v = validateMovePhotos(
    [fact({ id: 'p1' }), fact({ id: 'p1' }), fact({ id: 'p2', tripId: 'trip-b' })],
    'album-1',
    'trip-b',
  )
  assert.equal(v.photos.length, 1)
  assert.equal(v.photos[0].id, 'p1')
  assert.deepEqual(v.skippedSameTrip, ['p2'])
  assert.deepEqual([...v.sourceTripIds], ['trip-a'])
})

test('validateMovePhotos：跨相册移动被拒绝（中文错误可直出）', () => {
  assert.throws(
    () =>
      validateMovePhotos(
        [fact({ id: 'p1', albumId: 'album-1' }), fact({ id: 'p2', albumId: 'album-2' })],
        'album-1',
        'trip-b',
      ),
    /其他相册/,
  )
})

test('validateMovePhotos：目标旅行相同且全部跳过时 photos 为空', () => {
  const v = validateMovePhotos([fact({ id: 'p1', tripId: 'trip-b' })], 'album-1', 'trip-b')
  assert.equal(v.photos.length, 0)
  assert.deepEqual(v.skippedSameTrip, ['p1'])
})

test('collisionSafeDestName：不重名保持原名（大小写不敏感探测）', () => {
  const none = collisionSafeDestName('a.jpg', () => false, 1000)
  assert.equal(none, 'a.jpg')
  const caseHit = collisionSafeDestName('a.jpg', (n) => n === 'a.jpg', 1000)
  assert.equal(caseHit, '1000_a.jpg')
  // macOS 大小写不敏感文件系统：A.jpg 会撞 a.jpg
  const caseHit2 = collisionSafeDestName('A.jpg', (n) => n === 'a.jpg', 2000)
  assert.equal(caseHit2, '2000_A.jpg')
})

test('collisionSafeDestName：时间戳名仍被占用时继续避让', () => {
  const taken = new Set(['a.jpg', '1000_a.jpg'])
  const name = collisionSafeDestName('a.jpg', (n) => taken.has(n), 1000)
  assert.notEqual(name, 'a.jpg')
  assert.notEqual(name, '1000_a.jpg')
  assert.ok(name.endsWith('a.jpg'))
})

test('planCoverReassignment：封面被移走 → 剩余第一张接任', () => {
  const plans = planCoverReassignment(
    [
      {
        tripId: 'trip-a',
        coverPhotoId: 'c1',
        remainingPhotoIds: ['r1', 'r2'],
      },
    ],
    new Set(['c1']),
  )
  assert.deepEqual(plans, [{ tripId: 'trip-a', coverPhotoId: 'r1' }])
})

test('planCoverReassignment：照片全部移空 → 封面清空', () => {
  const plans = planCoverReassignment(
    [{ tripId: 'trip-a', coverPhotoId: 'c1', remainingPhotoIds: [] }],
    new Set(['c1']),
  )
  assert.deepEqual(plans, [{ tripId: 'trip-a', coverPhotoId: null }])
})

test('planCoverReassignment：封面未随照片移动 → 不产生条目', () => {
  const plans = planCoverReassignment(
    [{ tripId: 'trip-a', coverPhotoId: 'keep', remainingPhotoIds: ['keep'] }],
    new Set(['c1']),
  )
  assert.deepEqual(plans, [])
})

test('planCoverReassignment：无封面的旅行被抽走照片 → 不产生条目', () => {
  const plans = planCoverReassignment(
    [{ tripId: 'trip-a', coverPhotoId: null, remainingPhotoIds: [] }],
    new Set(['c1']),
  )
  assert.deepEqual(plans, [])
})
