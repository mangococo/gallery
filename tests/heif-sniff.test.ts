import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isHeifBuffer, HEIF_SNIFF_BYTES } from '../src/main/services/heif-sniff.ts'

/** 按 ISOBMFF 拼 ftyp box：size + 'ftyp' + major brand + minor version + compatible brands */
function box(major: string, compat: string[] = [], prefix: Buffer = Buffer.alloc(0)): Buffer {
  const body = Buffer.concat([
    Buffer.from('ftyp', 'latin1'),
    Buffer.from(major, 'latin1'),
    Buffer.alloc(4),
    ...compat.map((b) => Buffer.from(b, 'latin1')),
  ])
  const size = Buffer.alloc(4)
  size.writeUInt32BE(body.length + 4)
  return Buffer.concat([prefix, size, body])
}

test('isHeifBuffer：微信伪装样本形态（前 24 字节：ftyp + heic + mif1/heic）', () => {
  const b = Buffer.alloc(24)
  b.writeUInt32BE(0x18, 0)
  b.write('ftyp', 4, 'latin1')
  b.write('heic', 8, 'latin1')
  b.writeUInt32BE(0, 12)
  b.write('mif1', 16, 'latin1')
  b.write('heic', 20, 'latin1')
  assert.equal(isHeifBuffer(b), true)
})

test('isHeifBuffer：iPhone 形态（major=mif1，compatible brands 含 heic）', () => {
  assert.equal(isHeifBuffer(box('mif1', ['mif1', 'heic'])), true)
})

test('isHeifBuffer：各 HEIF 家族 major brand 均命中', () => {
  for (const brand of ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heif']) {
    assert.equal(isHeifBuffer(box(brand)), true, `major=${brand} 应判定 HEIF`)
  }
})

test('isHeifBuffer：compatible brands 命中也算（major 陌生但兼容表含 heic）', () => {
  assert.equal(isHeifBuffer(box('xxxx', ['mif1', 'heic'])), true)
})

test('isHeifBuffer：JPEG/PNG/AVIF/MP4/截断/空buffer 均不命中', () => {
  const jpeg = Buffer.from('ffd8ffe000104a46494600', 'hex')
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex')
  const avif = box('avif', ['avif', 'mif1', 'miaf']) // AVIF 走 sharp 原生 AV1，不进 WASM 回退
  const mp4 = box('isom', ['isom', 'iso2', 'mp41'])
  const tiny = Buffer.from('0000000c667479', 'hex')
  const cases: [string, Buffer][] = [
    ['jpeg', jpeg],
    ['png', png],
    ['avif', avif],
    ['mp4', mp4],
    ['tiny', tiny],
    ['empty', Buffer.alloc(0)],
  ]
  for (const [name, buf] of cases) {
    assert.equal(isHeifBuffer(buf), false, `${name} 不应判定 HEIF`)
  }
})

test('isHeifBuffer：ftyp 前有填充字节时不误判（嗅探只认文件头）', () => {
  // ISOBMFF 要求 ftyp 在文件最前；前面塞 JPEG 魔法字节再接 ftyp heic → 不命中
  const prefixed = box('heic', [], Buffer.from('ffd8ffe0', 'hex'))
  assert.equal(isHeifBuffer(prefixed), false)
})

test('isHeifBuffer：ftyp box 声明的 size 超出给定字节时，只扫已有 brand', () => {
  const b = Buffer.alloc(16)
  b.writeUInt32BE(0xffffffff, 0) // 畸形 size
  b.write('ftyp', 4, 'latin1')
  b.write('heic', 8, 'latin1')
  assert.equal(isHeifBuffer(b), true)
})

test('HEIF_SNIFF_BYTES 足够覆盖常见 ftyp box（iPhone/微信样本为 24-32 字节）', () => {
  assert.ok(HEIF_SNIFF_BYTES >= 64, `嗅探窗口 ${HEIF_SNIFF_BYTES} 应 ≥ 64`)
})
