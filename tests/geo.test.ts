import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wgs84ToGcj02, outOfChina } from '../src/shared/geo.ts'

test('wgs84ToGcj02：eviltransform 参考点（上海）数值一致', () => {
  const [lat, lon] = wgs84ToGcj02(31.1774276, 121.5272106)
  assert.ok(Math.abs(lat - 31.17530398364597) < 1e-9, `lat=${lat}`)
  assert.ok(Math.abs(lon - 121.531541859215) < 1e-9, `lon=${lon}`)
})

test('wgs84ToGcj02：北京天安门偏移量在公开算法公认范围内（约 +0.002~+0.007°）', () => {
  const [lat, lon] = wgs84ToGcj02(39.907333, 116.391226)
  const dLat = lat - 39.907333
  const dLon = lon - 116.391226
  assert.ok(dLat > 0.001 && dLat < 0.008, `dLat=${dLat}`)
  assert.ok(dLon > 0.002 && dLon < 0.009, `dLon=${dLon}`)
})

test('wgs84ToGcj02：境外坐标不偏移（东京/冰岛）', () => {
  assert.deepEqual(wgs84ToGcj02(35.681236, 139.767125), [35.681236, 139.767125])
  assert.deepEqual(wgs84ToGcj02(64.0464, -16.1776), [64.0464, -16.1776])
})

test('outOfChina：边界判定', () => {
  assert.equal(outOfChina(39.9, 116.4), false) // 北京
  assert.equal(outOfChina(31.2, 121.5), false) // 上海
  assert.equal(outOfChina(35.68, 139.77), true) // 东京
  assert.equal(outOfChina(64.0, -16.2), true) // 冰岛
  assert.equal(outOfChina(25.65, 100.23), false) // 大理（境内）
})
