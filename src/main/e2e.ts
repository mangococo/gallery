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
      let value: unknown
      if (step.script) {
        value = await win.webContents.executeJavaScript(
          `(async () => { ${step.script} })()`,
          true,
        )
      }
      await new Promise((r) => setTimeout(r, step.wait ?? 800))
      if (step.log) console.log(`[e2e] ${step.name}:`, JSON.stringify(value))
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
