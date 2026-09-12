import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitFlatMediaFiles } from '../src/main/services/flat-media.ts'

const MEDIA = new Set(['img1.jpg', 'IMG_2.PNG', 'clip.mp4', 'vid.mov', 'pic.heic', 'a.jpeg', 'b.webp', 'c.gif'])
const isMediaName = (n: string) => MEDIA.has(n)

test('splitFlatMediaFiles：只收媒体文件，跳过目录/隐藏/非媒体', () => {
  const out = splitFlatMediaFiles(
    [
      { name: 'img1.jpg', isDirectory: false },
      { name: 'clip.mp4', isDirectory: false },
      { name: '上海之旅', isDirectory: true }, // 子目录不算（旅行模型）
      { name: '.DS_Store', isDirectory: false }, // 隐藏不算
      { name: '.settings.json', isDirectory: false },
      { name: 'index.html', isDirectory: false }, // 非媒体不算
      { name: 'notes.txt', isDirectory: false },
    ],
    isMediaName,
  )
  assert.deepEqual(out, ['img1.jpg', 'clip.mp4'])
})

test('splitFlatMediaFiles：空目录与全非媒体返回空（不触发归档引导）', () => {
  assert.deepEqual(splitFlatMediaFiles([], isMediaName), [])
  assert.deepEqual(
    splitFlatMediaFiles(
      [
        { name: 'a.txt', isDirectory: false },
        { name: '.hidden.jpg', isDirectory: false },
        { name: 'sub', isDirectory: true },
      ],
      isMediaName,
    ),
    [],
  )
})

test('splitFlatMediaFiles：大小写扩展名与多种媒体类型都收录', () => {
  const out = splitFlatMediaFiles(
    [
      { name: 'IMG_2.PNG', isDirectory: false },
      { name: 'pic.heic', isDirectory: false },
      { name: 'vid.mov', isDirectory: false },
      { name: 'b.webp', isDirectory: false },
    ],
    isMediaName,
  )
  assert.deepEqual(out, ['IMG_2.PNG', 'pic.heic', 'vid.mov', 'b.webp'])
})
