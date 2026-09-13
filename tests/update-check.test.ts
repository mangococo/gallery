import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseVersion,
  compareVersions,
  isUpdateAvailable,
  parseGitHubRelease,
  summarizeNotes,
  fetchLatestRelease,
} from '../src/main/services/update-check.ts'

test('parseVersion：宽容解析（v 前缀 / prerelease / build 后缀 / 空白）', () => {
  assert.deepEqual(parseVersion('0.13.0'), { major: 0, minor: 13, patch: 0 })
  assert.deepEqual(parseVersion('v0.14.1'), { major: 0, minor: 14, patch: 1 })
  assert.deepEqual(parseVersion(' V1.2.3-beta.1 '), { major: 1, minor: 2, patch: 3 })
  assert.deepEqual(parseVersion('2.0.0+build.99'), { major: 2, minor: 0, patch: 0 })
  assert.equal(parseVersion('abc'), null)
  assert.equal(parseVersion(''), null)
  assert.equal(parseVersion('0.13'), null)
  assert.equal(parseVersion('v0.13.x'), null)
})

test('compareVersions：三段逐级比较', () => {
  assert.equal(compareVersions('0.13.0', 'v0.14.0'), -1)
  assert.equal(compareVersions('0.14.0', '0.13.9'), 1)
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('0.13.0', '0.13.1'), -1)
  // 解析失败按不可比处理（0：不提示更新）
  assert.equal(compareVersions('bad', '0.14.0'), 0)
})

test('isUpdateAvailable：latest 严格大于 current 才提示', () => {
  assert.equal(isUpdateAvailable('0.13.0', 'v0.14.0'), true)
  assert.equal(isUpdateAvailable('0.13.0', 'v0.13.0'), false)
  assert.equal(isUpdateAvailable('0.14.2', 'v0.14.1'), false)
  assert.equal(isUpdateAvailable('0.13.0', 'not-a-version'), false)
})

test('parseGitHubRelease：完整响应 → ReleaseInfo（notes 走摘要）', () => {
  const json = {
    tag_name: 'v0.14.0',
    name: 'v0.14.0 · 旅行日期重算',
    published_at: '2026-09-10T08:00:00Z',
    html_url: 'https://github.com/mangococo/gallery/releases/tag/v0.14.0',
    body: '## 新增\n- 照片迁入迁出自动重算旅行日期\n\n## 修复\n- Windows 缩略图失败',
    assets: [
      { name: 'gallery-0.14.0-mac-arm64.dmg', size: 90000000, browser_download_url: 'https://example.com/a.dmg' },
      { name: 'gallery-0.14.0-win-x64.exe', size: 80000000, browser_download_url: 'https://example.com/a.exe' },
    ],
  }
  const info = parseGitHubRelease(json)
  assert.ok(info)
  assert.equal(info!.tagName, 'v0.14.0')
  assert.equal(info!.releasePageUrl, 'https://github.com/mangococo/gallery/releases/tag/v0.14.0')
  assert.equal(info!.assets.length, 2)
  assert.ok(info!.notesSummary.includes('自动重算旅行日期'))
  assert.ok(!info!.notesSummary.includes('##'))
})

test('parseGitHubRelease：缺 tag_name / html_url 的畸形响应 → null', () => {
  assert.equal(parseGitHubRelease({}), null)
  assert.equal(parseGitHubRelease({ tag_name: 'v1.0.0' }), null) // 无 html_url
  assert.equal(parseGitHubRelease(null), null)
  assert.equal(parseGitHubRelease('string'), null)
})

test('summarizeNotes：清 markdown 符号、压空白、超长截断', () => {
  assert.equal(summarizeNotes('## 标题\n- 甲\n- 乙'), '标题 甲 乙')
  assert.equal(summarizeNotes('`代码` 与 **加粗** [链接](https://x.y)'), '代码 与 加粗 链接')
  assert.equal(summarizeNotes('   '), '')
  const long = 'a'.repeat(300)
  const out = summarizeNotes(long, 160)
  assert.equal(out.length, 160)
  assert.ok(out.endsWith('…'))
})

const RESP = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body })

test('fetchLatestRelease：有新版 → status ok + updateAvailable', async () => {
  const r = await fetchLatestRelease(
    async () => RESP(200, { tag_name: 'v99.0.0', html_url: 'https://gh/release', name: 'v99', body: 'notes' }),
    '0.13.0',
  )
  assert.equal(r.status, 'ok')
  if (r.status === 'ok') {
    assert.equal(r.updateAvailable, true)
    assert.equal(r.latest?.tagName, 'v99.0.0')
    assert.equal(r.current, '0.13.0')
  }
})

test('fetchLatestRelease：无新版 / 404 无 release → ok + updateAvailable false / latest null', async () => {
  const same = await fetchLatestRelease(
    async () => RESP(200, { tag_name: 'v0.13.0', html_url: 'https://gh/r' }),
    '0.13.0',
  )
  assert.ok(same.status === 'ok' && !same.updateAvailable)

  const none = await fetchLatestRelease(async () => RESP(404, { message: 'Not Found' }), '0.13.0')
  assert.ok(none.status === 'ok' && none.latest === null && !none.updateAvailable)
})

test('fetchLatestRelease：网络异常 / 非 JSON → status error 带信息', async () => {
  const err = await fetchLatestRelease(async () => {
    throw new Error('boom')
  }, '0.13.0')
  assert.equal(err.status, 'error')
  if (err.status === 'error') assert.ok(err.message.includes('boom'))

  const badJson = await fetchLatestRelease(
    async () => ({ status: 200, ok: true, json: async () => { throw new Error('bad json') } }),
    '0.13.0',
  )
  assert.equal(badJson.status, 'error')
})
