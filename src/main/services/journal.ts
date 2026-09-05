import { BrowserWindow, app, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'
import type { JournalFormat, PhotoDTO, TripDTO } from '../../shared/types'
import { getTagsOfTrip, getTripRow, listPhotosOfTrip } from '../db'

/**
 * 手账导出：隐藏 BrowserWindow 渲染独立 HTML 模板（复用手账视觉：
 * 米白纸面 / 楷体展示字 / 拍立得照片 / 和纸胶带日期贴 / 缝线分隔），
 * PDF 走 printToPDF（矢量可打印），长图按内容高度分段 capturePage 后用 sharp 纵向拼接。
 * 导出为纸制品，固定米白亮色，不随应用主题。
 */

const PAPER_W = 900 // 长图逻辑宽度
const VIEWPORT_H = 1350 // 初始窗口高度（分段回退时的基准视口）
const MAX_SINGLE_H = 8000 // 单次整页截取的内容高度上限（逻辑像素，防内存失控）
const MAX_SEGMENTS = 40 // capturePage 拼接段数上限（超大旅行防内存失控）

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtDate(d: string): string {
  if (!d) return '——'
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function photoSrc(p: PhotoDTO): string {
  if (p.thumbStatus === 'ready' && p.thumbUrl) return p.thumbUrl
  return p.mediaUrl
}

function buildJournalHtml(trip: TripDTO): string {
  const photos = trip.photos.filter((p) => p.type === 'image')
  const cover = photos.find((p) => p.id === trip.coverPhotoId) ?? photos[0] ?? null
  const rest = cover ? photos.filter((p) => p.id !== cover.id) : []

  const photoCards = rest
    .map(
      (p, i) => `
      <figure class="card ${i % 2 ? 'tilt-r' : 'tilt-l'}">
        <img src="${photoSrc(p)}" alt="">
        <figcaption>
          ${p.caption ? `<span class="cap">${esc(p.caption)}</span>` : '<span class="cap dim">未写图注</span>'}
          ${p.takenAt != null ? `<span class="taken">${esc(fmtDate(new Date(p.takenAt).toISOString().slice(0, 10)))}</span>` : ''}
        </figcaption>
      </figure>`,
    )
    .join('')

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  /* 导出产物不允许烙入滚动条 */
  ::-webkit-scrollbar { width: 0; height: 0; display: none; }
  html { scrollbar-width: none; overflow-x: hidden; }
  html, body { background: #f6f1e7; }
  body {
    width: ${PAPER_W}px;
    color: #3b342e;
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .display { font-family: 'Kaiti SC', 'STKaiti', 'Kai', 'Songti SC', serif; }

  .page { padding: 56px 64px 48px; }

  /* —— 封面 —— */
  .cover { text-align: center; padding-top: 40px; }
  .washi {
    display: inline-block;
    padding: 6px 22px;
    font-size: 15px;
    letter-spacing: 2px;
    color: #a97b45;
    background: linear-gradient(to right,
      rgba(192,138,82,.2) 0 3px, #f0e4d0 3px calc(100% - 3px), rgba(192,138,82,.2) calc(100% - 3px));
    transform: rotate(-2deg);
    border-radius: 2px;
    box-shadow: 0 1px 3px rgba(0,0,0,.12);
  }
  h1.title { font-size: 52px; font-weight: 700; margin: 26px 0 10px; letter-spacing: 4px; }
  .dates { font-size: 16px; color: #8d7f6f; letter-spacing: 3px; }
  .desc {
    max-width: 620px; margin: 22px auto 0;
    font-size: 16px; line-height: 2; color: #5c5248;
    white-space: pre-wrap; text-align: left;
  }
  .cover-photo {
    width: 520px; margin: 34px auto 8px;
    background: #fffdf9; padding: 10px 10px 16px; border-radius: 6px;
    box-shadow: 0 2px 5px rgba(0,0,0,.12), 0 12px 30px rgba(0,0,0,.14);
    transform: rotate(-1.6deg);
  }
  .cover-photo img { width: 100%; border-radius: 3px; display: block; }
  .cover-missing {
    width: 520px; height: 300px; margin: 34px auto 8px;
    border: 2px dashed #d8c9ae; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: #b3a288; font-size: 20px; letter-spacing: 6px;
  }
  .tags { margin-top: 20px; }
  .tag {
    display: inline-block; margin: 0 5px; padding: 4px 14px;
    font-size: 13px; color: #a97b45;
    border: 1.5px solid #d3b98f; border-radius: 999px;
    transform: rotate(-1deg);
    background: rgba(240,228,208,.5);
  }

  /* —— 缝线分隔 —— */
  .stitch {
    height: 0; margin: 44px 0;
    border-top: 2px dashed rgba(192,138,82,.55);
  }

  /* —— 照片排版 —— */
  .section-title { text-align: center; font-size: 24px; letter-spacing: 8px; color: #8d7f6f; margin-bottom: 30px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 34px 30px; }
  .card {
    background: #fffdf9; padding: 8px 8px 10px; border-radius: 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,.1), 0 8px 20px rgba(0,0,0,.1);
    break-inside: avoid; page-break-inside: avoid;
  }
  .card.tilt-l { transform: rotate(-1.1deg); }
  .card.tilt-r { transform: rotate(1.1deg); }
  .card img { width: 100%; border-radius: 3px; display: block; background: #efe7d8; }
  figcaption {
    display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
    padding: 8px 2px 0;
  }
  .cap { font-family: 'Kaiti SC', 'STKaiti', 'Kai', serif; font-size: 15px; color: #4c4339; }
  .cap.dim { color: #b9ab97; }
  .taken { font-size: 11px; color: #b3a288; white-space: nowrap; font-family: 'Kaiti SC', serif; }

  .footer {
    margin-top: 48px; text-align: center;
    font-size: 12px; letter-spacing: 4px; color: #c2b39a;
  }
  @media print {
    body { width: auto; }
    .page { padding: 24px 8px; }
  }
</style>
</head>
<body>
  <div class="page">
    <section class="cover">
      <span class="washi display">${esc(fmtDate(trip.startDate))} — ${esc(fmtDate(trip.endDate))}</span>
      <h1 class="title display">${esc(trip.title)}</h1>
      <div class="dates display">旅 行 手 账</div>
      ${trip.description ? `<p class="desc">${esc(trip.description)}</p>` : ''}
      ${
        cover
          ? `<div class="cover-photo"><img src="${photoSrc(cover)}" alt=""></div>`
          : '<div class="cover-missing display">暂 无 封 面</div>'
      }
      ${
        trip.tags.length
          ? `<div class="tags">${trip.tags.map((t) => `<span class="tag display">#${esc(t)}</span>`).join('')}</div>`
          : ''
      }
    </section>

    <div class="stitch"></div>

    ${
      photos.length
        ? `<section>
            <div class="section-title display">${photos.length} 张照片</div>
            <div class="grid">${cover ? photoCards : ''}</div>
          </section>`
        : '<section><div class="section-title display">这次旅行还没有照片</div></section>'
    }

    <div class="footer display">画 廊 · 旅 行 手 账</div>
  </div>
</body>
</html>`
}

/** 等待窗口内全部图片加载完成（15s 兜底超时） */
async function waitImagesLoaded(win: BrowserWindow): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const pending = await win.webContents.executeJavaScript(
      `[...document.images].filter(i => !i.complete || i.naturalWidth === 0).length`,
    )
    if (pending === 0) return
    await new Promise((r) => setTimeout(r, 120))
  }
}

export interface JournalExportResult {
  canceled: boolean
  path?: string
}

/** 导出指定旅行的手账；savePath 为空时弹系统保存对话框（E2E 直传跳过） */
export async function exportJournal(
  parentWin: BrowserWindow,
  tripId: string,
  format: JournalFormat,
  savePath: string | null,
): Promise<JournalExportResult> {
  const t = getTripRow(tripId)
  if (!t) throw new Error('旅行不存在')
  const trip: TripDTO = {
    ...t,
    tags: getTagsOfTrip(tripId),
    photos: listPhotosOfTrip(t.id, t.albumId, t.coverPhotoId),
  }

  const ext = format === 'pdf' ? 'pdf' : 'png'
  let target = savePath
  if (!target) {
    if (process.env.GALLERY_E2E === '1' && process.env.GALLERY_E2E_EXPORT_DIR) {
      target = join(process.env.GALLERY_E2E_EXPORT_DIR, `${trip.title}.${ext}`)
    } else {
      const res = await dialog.showSaveDialog(parentWin, {
        title: '导出手账',
        defaultPath: join(app.getPath('downloads'), `${trip.title}.${ext}`),
        filters: [
          format === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'PNG 长图', extensions: ['png'] },
        ],
      })
      if (res.canceled || !res.filePath) return { canceled: true }
      target = res.filePath
    }
  }

  const win = new BrowserWindow({
    show: false,
    width: PAPER_W,
    height: VIEWPORT_H,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  try {
    const html = buildJournalHtml(trip)
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await waitImagesLoaded(win)
    await new Promise((r) => setTimeout(r, 250))

    if (format === 'pdf') {
      const buf = await win.webContents.printToPDF({
        landscape: false,
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.35, bottom: 0.35, left: 0.35, right: 0.35 },
      })
      await writeFile(target, buf)
    } else {
      const buf = await captureLongImage(win)
      await writeFile(target, buf)
    }
  } finally {
    win.destroy()
  }
  return { canceled: false, path: target }
}

/** 长图：窗口内容直接 resize 到全高后单次 capturePage；超高再按实测段高回退分段拼接。
 * 坑（实测）：隐藏窗口的 capturePage 高度可能小于视口（macOS 只回部分绘制区），
 * 段高必须用返回尺寸反推，不能假设等于窗口高。 */
async function captureLongImage(win: BrowserWindow): Promise<Buffer> {
  const measure = (): Promise<{ body: number; doc: number; footerBottom: number }> =>
    win.webContents.executeJavaScript(
      `(() => {
        const f = document.querySelector('.footer');
        return {
          body: document.body.scrollHeight,
          doc: document.documentElement.scrollHeight,
          footerBottom: f ? Math.round(f.getBoundingClientRect().bottom + window.scrollY) : -1,
        };
      })()`,
    )
  const m1 = await measure()
  const totalH = Math.max(m1.body, m1.doc, m1.footerBottom)

  // 常规旅行：窗口内容区直接撑到全高，一次截取（无滚动 → 无滚动条烙印、无拼接缝）
  if (totalH <= MAX_SINGLE_H) {
    win.setContentSize(PAPER_W, totalH)
    await new Promise((r) => setTimeout(r, 300))
    const m2 = await measure()
    const finalH = Math.max(m2.body, m2.doc, m2.footerBottom)
    if (finalH > totalH) {
      win.setContentSize(PAPER_W, finalH)
      await new Promise((r) => setTimeout(r, 300))
    }
    const img = await win.webContents.capturePage()
    const size = img.getSize()
    console.log(`[journal] 单次截取: 内容 ${finalH} → capture ${size.width}x${size.height}`)
    if (size.height >= Math.round(finalH * (size.width / PAPER_W) * 0.98)) {
      return img.toPNG()
    }
    // 尺寸不符则继续走分段
  }

  // 超高旅行：按实测段高滚动拼接
  const segments: number[] = []
  const step = Math.max(600, Math.floor(VIEWPORT_H * 0.7))
  for (let y = 0; y < totalH && segments.length < MAX_SEGMENTS; y += step) {
    segments.push(y)
  }
  const captures: { top: number; buf: Buffer }[] = []
  let physW = PAPER_W * 2
  for (const y of segments) {
    await win.webContents.executeJavaScript(`window.scrollTo(0, ${y})`)
    await new Promise((r) => setTimeout(r, 120))
    const img = await win.webContents.capturePage()
    const size = img.getSize()
    physW = size.width
    console.log(`[journal] 段 y=${y}: capture ${size.width}x${size.height}`)
    captures.push({ top: y, buf: await img.toPNG() })
  }
  const dpr = physW / PAPER_W
  const canvasH = Math.round(totalH * dpr)
  const composites = captures.map((c) => ({ input: c.buf, left: 0, top: Math.round(c.top * dpr) }))
  return sharp({ create: { width: physW, height: canvasH, channels: 3, background: '#f6f1e7' } })
    .composite(composites)
    .png()
    .toBuffer()
}
