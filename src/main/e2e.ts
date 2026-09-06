import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

interface E2EStep {
  name: string
  /** 在页面里执行的 JS（可异步），用于驱动 UI 状态 */
  script?: string
  /** 执行后等待毫秒数（默认 800） */
  wait?: number
  /** 打印脚本的返回值（用于数据断言） */
  log?: boolean
  /**
   * 真实输入事件（webContents.sendInputEvent，走完整 Chromium 输入管线，
   * 含 app-region 拖拽区判定——executeJavaScript 合成事件测不出 drag-region 吞点击的问题）。
   * 给 selector 时先在页面里量出元素中心坐标（视口像素），再派发真实点击。
   */
  click?: { x?: number; y?: number; selector?: string }
  /** 真实鼠标移动（触发 hover 态）；支持 selector */
  move?: { x?: number; y?: number; selector?: string }
}

async function resolvePoint(
  win: Electron.BrowserWindow,
  pt: { x?: number; y?: number; selector?: string },
): Promise<{ x: number; y: number }> {
  if (pt.selector) {
    const found = (await win.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(pt.selector)})
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
      })()`,
      true,
    )) as { x: number; y: number } | null
    if (!found) throw new Error(`click/move 定位失败: ${pt.selector}`)
    return found
  }
  return { x: pt.x ?? 0, y: pt.y ?? 0 }
}

async function sendClick(win: Electron.BrowserWindow, x: number, y: number): Promise<void> {
  win.webContents.sendInputEvent({ type: 'mouseMove', x, y })
  await new Promise((r) => setTimeout(r, 60))
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
  await new Promise((r) => setTimeout(r, 60))
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  await new Promise((r) => setTimeout(r, 60))
}

/**
 * 验收截图工具：GALLERY_E2E=1 时启用。
 * 从 GALLERY_E2E_STEPS 指定的 JSON 读取步骤列表，逐条在页面内执行脚本并截图，
 * 输出到 GALLERY_E2E_DIR（默认 /tmp/gallery-e2e），最后自动退出。
 */
export async function runE2EIfEnabled(win: Electron.BrowserWindow): Promise<void> {
  if (process.env.GALLERY_E2E !== '1') return

  try {
    const outDir = process.env.GALLERY_E2E_DIR || '/tmp/gallery-e2e'
    await fs.mkdir(outDir, { recursive: true })

    let steps: E2EStep[] = [{ name: 'default' }]
    const stepsPath = process.env.GALLERY_E2E_STEPS
    if (stepsPath) {
      steps = JSON.parse(await fs.readFile(stepsPath, 'utf8'))
    }

    // 等待首次加载完成
    await new Promise<void>((resolve) => {
      if (win.webContents.getURL() && !win.webContents.isLoading()) {
        resolve()
      } else {
        win.webContents.once('did-finish-load', () => resolve())
      }
    })

    for (const step of steps) {
      // 先等待（给外部操作/异步任务留时间），再执行输入/脚本，再截图
      await new Promise((r) => setTimeout(r, step.wait ?? 800))
      if (step.move) {
        const p = await resolvePoint(win, step.move)
        win.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y })
        await new Promise((r) => setTimeout(r, 120))
      }
      if (step.click) {
        const p = await resolvePoint(win, step.click)
        await sendClick(win, p.x, p.y)
      }
      let value: unknown
      if (step.script) {
        try {
          value = await win.webContents.executeJavaScript(
            `(async () => { ${step.script} })()`,
            true,
          )
        } catch (err) {
          console.error(`[e2e] ${step.name} 脚本出错:`, (err as Error)?.message ?? err)
        }
        if (step.log) console.log(`[e2e] ${step.name}:`, JSON.stringify(value))
      }
      const image = await win.webContents.capturePage()
      const file = join(outDir, `${step.name}.png`)
      await fs.writeFile(file, image.toPNG())
      console.log(`[e2e] 截图: ${file}`)
    }
  } catch (err) {
    console.error('[e2e] 执行失败:', err)
  } finally {
    app.quit()
  }
}
