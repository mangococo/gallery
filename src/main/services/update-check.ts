/**
 * 软件更新检查（纯逻辑层，无 electron 依赖，node --test 直接测）。
 * 数据源：GitHub Releases API（repo mangococo/gallery，公开仓库匿名额度足够手动检查）。
 * 网络经 fetcher 注入：生产传全局 fetch，测试/E2E 传 mock——真实请求只在用户手动触发时发生。
 *
 * 形态决策（v0.11 曾定「不做 Win 自动更新」，本次明确要做，但止步于「检查 + 引导」）：
 * 不做 electron-updater 静默安装——NSIS 差分更新要求安装包稳定 URL + latest.yml，
 * 且无代码签名证书的 Windows 应用自更新会触发 SmartScreen/劫持告警，
 * 信任成本高于让用户自己到 Release 页下载；macOS 无签名同样会被 Gatekeeper 拦。
 */

export const RELEASES_API_URL = 'https://api.github.com/repos/mangococo/gallery/releases/latest'
export const RELEASES_PAGE_URL = 'https://github.com/mangococo/gallery/releases'

export type { ReleaseAsset, ReleaseInfo, UpdateCheckResult } from '../../shared/types.ts'
import type { ReleaseAsset, ReleaseInfo, UpdateCheckResult } from '../../shared/types.ts'

/** 宽容解析三段版本号：v 前缀、空白、prerelease(-beta.1)/build(+x) 后缀；解析失败 null */
export function parseVersion(s: string): { major: number; minor: number; patch: number } | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?\s*$/i.exec(s)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/** 三段逐级比较；任一解析失败按不可比返回 0（调用方不提示更新） */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (!va || !vb) return 0
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (va[key] !== vb[key]) return va[key] < vb[key] ? -1 : 1
  }
  return 0
}

/** latest 严格大于 current 才提示（同版本/回退/tag 非法都不提示） */
export function isUpdateAvailable(current: string, latestTag: string): boolean {
  return compareVersions(current, latestTag) < 0
}

/** 发布说明摘要：清常见 markdown 符号、压空白，超长截断（用于弹窗内一行预览） */
export function summarizeNotes(body: unknown, maxLen = 160): string {
  if (typeof body !== 'string') return ''
  const flat = body
    .replace(/```[\s\S]*?```/g, ' ') // 代码块整体省略
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只留文字
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= maxLen) return flat
  return flat.slice(0, maxLen - 1) + '…'
}

type RawRelease = Record<string, unknown>

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** GitHub /releases/latest 响应 → ReleaseInfo；缺关键字段（tag/html_url）返回 null */
export function parseGitHubRelease(json: unknown): ReleaseInfo | null {
  if (typeof json !== 'object' || json === null) return null
  const r = json as RawRelease
  const tagName = asString(r.tag_name)
  const releasePageUrl = asString(r.html_url)
  if (!tagName || !releasePageUrl) return null
  const assets: ReleaseAsset[] = Array.isArray(r.assets)
    ? (r.assets as RawRelease[])
        .map((a) => ({
          name: asString(a.name) ?? '',
          size: typeof a.size === 'number' ? a.size : 0,
          url: asString(a.browser_download_url) ?? '',
        }))
        .filter((a) => a.name && a.url)
    : []
  return {
    tagName,
    name: asString(r.name) ?? tagName,
    notesSummary: summarizeNotes(r.body),
    publishedAt: asString(r.published_at) ?? '',
    releasePageUrl,
    assets,
  }
}

/** 生产 fetch 的最小形状（Response 子集；测试注入用） */
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  status: number
  ok: boolean
  json: () => Promise<unknown>
}>

/** 拉最新 Release 并比对当前版本；仅手动触发时调用。网络失败返回 error（UI 提示原因） */
export async function fetchLatestRelease(
  fetcher: FetchLike,
  currentVersion: string,
  timeoutMs = 8000,
): Promise<UpdateCheckResult> {
  let resp: Awaited<ReturnType<FetchLike>>
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      resp = await fetcher(RELEASES_API_URL, {
        headers: { accept: 'application/vnd.github+json' },
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    return { status: 'error', message: (err as Error)?.message ?? String(err) }
  }
  // /releases/latest 在仓库还没有 Release 时返回 404：不是错误，按「无发布」处理
  if (resp.status === 404) return { status: 'ok', current: currentVersion, latest: null, updateAvailable: false }
  if (!resp.ok) return { status: 'error', message: `GitHub API ${resp.status}` }
  let json: unknown
  try {
    json = await resp.json()
  } catch (err) {
    return { status: 'error', message: '响应解析失败：' + ((err as Error)?.message ?? err) }
  }
  const latest = parseGitHubRelease(json)
  if (!latest) return { status: 'error', message: 'Release 数据不完整' }
  return {
    status: 'ok',
    current: currentVersion,
    latest,
    updateAvailable: isUpdateAvailable(currentVersion, latest.tagName),
  }
}
