import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitThumbJobs, resolveImageConcurrency } from '../src/main/services/thumb-plan.ts'

test('splitThumbJobs：图片/视频分队列，慢视频不再占住图片 worker', () => {
  const jobs = [
    { id: 'a', type: 'image' },
    { id: 'b', type: 'video' },
    { id: 'c', type: 'image' },
    { id: 'd', type: 'video' },
    { id: 'e', type: 'image' },
  ]
  const { images, videos } = splitThumbJobs(jobs)
  assert.deepEqual(images.map((j) => j.id), ['a', 'c', 'e'])
  assert.deepEqual(videos.map((j) => j.id), ['b', 'd'])
})

test('splitThumbJobs：空队列与单一类型', () => {
  assert.deepEqual(splitThumbJobs([]), { images: [], videos: [] })
  assert.deepEqual(splitThumbJobs([{ id: 'v', type: 'video' }]), { images: [], videos: [{ id: 'v', type: 'video' }] })
})

test('resolveImageConcurrency：默认按核数自适应，夹在 [3, 8]', () => {
  assert.equal(resolveImageConcurrency({}, 2), 3) // 低核机下限 3
  assert.equal(resolveImageConcurrency({}, 4), 3)
  assert.equal(resolveImageConcurrency({}, 10), 8) // 高核机上限 8
  assert.equal(resolveImageConcurrency({}, 100), 8)
})

test('resolveImageConcurrency：环境变量显式覆盖，夹在 [1, 16]', () => {
  assert.equal(resolveImageConcurrency({ GALLERY_THUMB_IMAGE_CONCURRENCY: '1' }, 10), 1)
  assert.equal(resolveImageConcurrency({ GALLERY_THUMB_IMAGE_CONCURRENCY: '12' }, 4), 12)
  assert.equal(resolveImageConcurrency({ GALLERY_THUMB_IMAGE_CONCURRENCY: '64' }, 4), 16) // 上限
  // 非法值回退默认
  assert.equal(resolveImageConcurrency({ GALLERY_THUMB_IMAGE_CONCURRENCY: 'abc' }, 10), 8)
  assert.equal(resolveImageConcurrency({ GALLERY_THUMB_IMAGE_CONCURRENCY: '-2' }, 10), 8)
  assert.equal(resolveImageConcurrency({ GALLERY_THUMB_IMAGE_CONCURRENCY: '' }, 10), 8)
})
