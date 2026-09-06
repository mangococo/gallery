import { app, BrowserWindow, Menu, nativeTheme, screen, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { registerMediaScheme, attachMediaProtocol, ensureThumbsDir } from './protocol'
import { registerIpcHandlers, registerAlbumAt, fullRescanInBackground } from './ipc'
import { runE2EIfEnabled } from './e2e'
import { closeWatcher } from './services/watcher'
import { disposeThumbResources } from './services/thumbnails'
import { backfillExifTakenAt, backfillPhotoGps } from './services/backfill'
import { getAlbumPath, getAlbumRow, getSetting, setSetting, closeDb, initDb } from './db'
import { setMainWindow } from './windows'
import type { ThemeMode } from '../shared/types'

let mainWindow: BrowserWindow | null = null

// 必须在 app.ready 之前注册
registerMediaScheme()

// 固定数据目录为「画廊」（dev 模式默认跟随 package name）；测试可用 GALLERY_USER_DATA 隔离。
// 必须先于 requestSingleInstanceLock：锁按 userData 目录 keyed，若先用默认目录申请，
// 任何其它 Electron 开发实例都会把隔离 userData 的本实例（E2E 链路）误杀成秒退空跑。
app.setName('画廊')
const userDataDir = process.env.GALLERY_USER_DATA || join(app.getPath('appData'), '画廊')
try {
  mkdirSync(userDataDir, { recursive: true })
} catch {
  // 已存在
}
app.setPath('userData', userDataDir)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 同数据目录已有实例（如已开打包版又跑 dev）：静默秒退很难排查，给出明确提示
  console.warn(`[画廊] 已有使用数据目录「${userDataDir}」的实例在运行，本次启动退出`)
  app.quit()
} else {
  // 主进程兜底：后台任务里的意外 rejection 不允许升级成崩溃（Node ≥15 默认行为）。
  // 只记录不吞——错误日志是排查现场的唯一线索
  process.on('unhandledRejection', (reason) => {
    console.error('[画廊] 未处理的 Promise 拒绝:', (reason as Error)?.stack ?? reason)
  })
  process.on('uncaughtException', (err) => {
    console.error('[画廊] 未捕获异常:', err?.stack ?? err)
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else {
      // darwin 关窗常驻后再次启动：重建窗口
      createMainWindow()
    }
  })

  app.whenReady().then(async () => {
    initDb()

    // 启动即恢复持久化主题（nativeTheme 先于建窗，backgroundColor 防首帧闪烁）
    const savedTheme = (getSetting('theme_mode') as ThemeMode | null) ?? 'system'
    if (savedTheme !== 'system') nativeTheme.themeSource = savedTheme

    attachMediaProtocol({
      resolveAlbumRoot: async (albumId) => getAlbumPath(albumId),
      thumbsDir() {
        return join(app.getPath('userData'), 'thumbnails')
      },
    })
    await ensureThumbsDir()

    registerIpcHandlers()
    installChineseMenu()

    // 一次性回填存量照片的 EXIF 拍摄时间与 GPS（后台执行，不阻塞启动）
    void backfillExifTakenAt().catch((err) => {
      console.error('[backfill] EXIF 回填失败:', (err as Error)?.message ?? err)
    })
    void backfillPhotoGps().catch((err) => {
      console.error('[backfill] GPS 回填失败:', (err as Error)?.message ?? err)
    })

    // 启动时对激活相册做增量校对并附加 watcher（覆盖关机期间的外部变更）
    const activeId = getSetting('active_album_id')
    if (activeId && getAlbumRow(activeId)) {
      fullRescanInBackground(activeId)
    }

    // E2E 钩子：跳过目录选择对话框直接注册指定路径（多个用 | 分隔，第一个设为激活）
    if (process.env.GALLERY_E2E === '1' && process.env.GALLERY_E2E_ALBUM) {
      const paths = process.env.GALLERY_E2E_ALBUM.split('|')
      void (async () => {
        let first = true
        for (const p of paths) {
          const album = await registerAlbumAt(p, true)
          if (album && first) {
            setSetting('active_album_id', album.id)
            first = false
          }
        }
      })()
    }

    createMainWindow()
  })

  app.on('window-all-closed', () => {
    // macOS 惯例：关窗不退出，Dock 图标常驻，点击 Dock/再次启动重建窗口
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    closeWatcher()
    disposeThumbResources()
    closeDb()
  })

  app.on('activate', () => {
    // macOS：点击 Dock 图标时若窗口已关则重建
    if (mainWindow === null) createMainWindow()
  })
}

/** 恢复记忆的窗口尺寸位置；位置钳制到可见显示器（外接显示器拔掉后窗口不再开在屏外） */
function restoreWindowBounds(): { width: number; height: number; x?: number; y?: number } {
  const defaults = { width: 1280, height: 820 }
  try {
    const raw = getSetting('window_bounds')
    if (!raw) return defaults
    const b = JSON.parse(raw) as { width: number; height: number; x?: number; y?: number }
    if (typeof b.width !== 'number' || typeof b.height !== 'number') return defaults
    const wa = screen.getDisplayMatching({
      x: b.x ?? 0,
      y: b.y ?? 0,
      width: b.width,
      height: b.height,
    }).workArea
    // 至少把标题栏区域留在工作区内，用户能看见并拖回
    const x = Math.min(Math.max(b.x ?? wa.x, wa.x), wa.x + wa.width - 160)
    const y = Math.min(Math.max(b.y ?? wa.y, wa.y), wa.y + wa.height - 60)
    return { width: b.width, height: b.height, x, y }
  } catch {
    // 损坏的窗口状态回退默认值
    return defaults
  }
}

/** 创建主窗口（首次启动、Dock 激活、二次启动共用） */
function createMainWindow(): void {
  const savedTheme = (getSetting('theme_mode') as ThemeMode | null) ?? 'system'
  const dark = savedTheme === 'dark' || (savedTheme === 'system' && nativeTheme.shouldUseDarkColors)
  const bounds = restoreWindowBounds()

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: '画廊',
    titleBarStyle: 'hiddenInset',
    backgroundColor: dark ? '#1C1916' : '#FAF8F5',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // E2E 驱动时窗口常被真实窗口遮挡，macOS 会判定 occluded 并把 rAF/动画降到约 1/10 速度，
      // framer-motion 退场动画被拉长导致「看似未关闭」的假阴性——E2E 下关掉节流
      backgroundThrottling: process.env.GALLERY_E2E !== '1',
    },
  })

  setMainWindow(mainWindow)
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 记忆窗口位置尺寸
  const saveBounds = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    setSetting('window_bounds', JSON.stringify(mainWindow.getBounds()))
  }
  mainWindow.on('resized', saveBounds)
  mainWindow.on('moved', saveBounds)
  mainWindow.on('close', saveBounds)

  mainWindow.on('closed', () => {
    mainWindow = null
    setMainWindow(null)
  })

  // 加载渲染层
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // E2E 验收截图（仅 GALLERY_E2E=1 时启用）
  void runE2EIfEnabled(mainWindow)
}

/** 标准 macOS 菜单（中文文案，保证 ⌘C/⌘V 等快捷键） */
function installChineseMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '画廊',
      submenu: [
        { role: 'about', label: '关于画廊' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏画廊' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出画廊' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '显示',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '进入全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
