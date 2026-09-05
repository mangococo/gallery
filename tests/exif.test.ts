import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import piexif from 'piexifjs'
import { mediaTypeOf } from '../src/shared/media.ts'
import { resolvePhotoTakenAt, readExifTakenAt, readExifGps } from '../src/main/services/exif.ts'

let dir: string

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gallery-exif-test-'))
  // 带 EXIF 拍摄时间 + GPS 的样张（piexifjs 注入，模拟手机原片）
  const base = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#336699' },
  })
    .jpeg()
    .toBuffer()
  const exif = piexif.dump({
    Exif: { [piexif.ExifIFD.DateTimeOriginal]: '2025:11:02 08:17:00' },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: 'N',
      [piexif.GPSIFD.GPSLatitude]: [[35, 1], [0, 1], [3050, 100]],
      [piexif.GPSIFD.GPSLongitudeRef]: 'E',
      [piexif.GPSIFD.GPSLongitude]: [[135, 1], [45, 1], [0, 1]],
    },
  })
  const dataUrl = 'data:image/jpeg;base64,' + base.toString('base64')
  writeFileSync(join(dir, 'with-exif.jpg'), Buffer.from(piexif.insert(exif, dataUrl).split(',')[1], 'base64'))
  // 无 EXIF 样张
  writeFileSync(join(dir, 'no-exif.jpg'), base)
})

after(() => {
  rmSync(dir, { recursive: true, force: true })
})

test('mediaTypeOf：图片/视频/未知/无扩展名', () => {
  assert.equal(mediaTypeOf('DSC001.JPG'), 'image')
  assert.equal(mediaTypeOf('clip.MOV'), 'video')
  assert.equal(mediaTypeOf('IMG_0001.heic'), 'image')
  assert.equal(mediaTypeOf('notes.txt'), null)
  assert.equal(mediaTypeOf('noext'), null)
})

test('readExifTakenAt：读出 DateTimeOriginal', async () => {
  const t = await readExifTakenAt(join(dir, 'with-exif.jpg'))
  assert.ok(t !== null)
  const d = new Date(t!)
  // EXIF 无时区，按本机时区解读
  assert.equal(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, '2025-11-02')
})

test('readExifTakenAt：无 EXIF 返回 null', async () => {
  assert.equal(await readExifTakenAt(join(dir, 'no-exif.jpg')), null)
})

test('resolvePhotoTakenAt：图片优先 EXIF，回退 mtime；视频直接 mtime', async () => {
  const mtime = new Date('2026-01-15T12:00:00').getTime()
  const withExif = await resolvePhotoTakenAt(join(dir, 'with-exif.jpg'), 'image', mtime)
  const d = new Date(withExif)
  assert.equal(d.getFullYear(), 2025) // EXIF 时间，非 mtime 的 2026

  const noExif = await resolvePhotoTakenAt(join(dir, 'no-exif.jpg'), 'image', mtime)
  assert.equal(noExif, Math.round(mtime))

  const video = await resolvePhotoTakenAt(join(dir, 'no-exif.jpg'), 'video', mtime)
  assert.equal(video, Math.round(mtime))
})

test('readExifGps：读出十进制坐标，全零与坏文件判无效', async () => {
  const gps = await readExifGps(join(dir, 'with-exif.jpg'))
  assert.ok(gps)
  assert.equal(Math.round(gps!.lat * 1000) / 1000, 35.008) // 35°0'30.5"
  assert.equal(gps!.lon, 135.75)

  assert.equal(await readExifGps(join(dir, 'no-exif.jpg')), null)
  assert.equal(await readExifGps(join(dir, 'missing.jpg')), null)
})
