import { app, BrowserWindow, Menu, nativeTheme, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { registerMediaScheme, attachMediaProtocol, ensureThumbsDir } from './protocol'
import { registerIpcHandlers, registerAlbumAt, fullRescan } from './ipc'
import { runE2EIfEnabled } from './e2e'
import { closeWatcher } from './services/watcher'
import { disposeThumbResources } from './services/thumbnails'
import { backfillExifTakenAt } from './services/backfill'
import { getAlbumPath, getAlbumRow, getSetting, setSetting, closeDb, initDb } from './db'
import type { ThemeMode } from '../shared/types'

let mainWindow: BrowserWindow | null = null

// 必须在 app.ready 之前注册
registerMediaScheme()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.setName('画廊')
  // 固定数据目录为「画廊」（dev 模式默认跟随 package name）；测试可用 GALLERY_USER_DATA 隔离
  const userDataDir = process.env.GALLERY_USER_DATA || join(app.getPath('appData'), '画廊')
  try {
    mkdirSync(userDataDir, { recursive: true })
  } catch {
    // 已存在
  }
  app.setPath('userData', userDataDir)

  app.whenReady().then(async () => {
    initDb()

    // 启动即恢复持久化主题（窗口背景色与 nativeTheme 同步，防首帧闪烁）
    const savedTheme = (getSetting('theme_mode') as ThemeMode | null) ?? 'system'
    if (savedTheme !== 'system') nativeTheme.themeSource = savedTheme
    const darkAtBoot =
      savedTheme === 'dark' || (savedTheme === 'system' && nativeTheme.shouldUseDarkColors)

    attachMediaProtocol({
      resolveAlbumRoot: async (albumId) => getAlbumPath(albumId),
      thumbsDir() {
        return join(app.getPath('userData'), 'thumbnails')
      },
    })
    await ensureThumbsDir()

    registerIpcHandlers()
    installChineseMenu()

    // 一次性回填存量照片的 EXIF 拍摄时间（后台执行，不阻塞启动）
    void backfillExifTakenAt()

    // 启动时对激活相册做增量校对并附加 watcher（覆盖关机期间的外部变更）
    const activeId = getSetting('active_album_id')
    if (activeId && getAlbumRow(activeId)) {
      void fullRescan(activeId)
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

    // 恢复上次窗口尺寸位置
    let bounds: { width: number; height: number; x?: number; y?: number } | undefined
    try {
      const raw = getSetting('window_bounds')
      if (raw) bounds = JSON.parse(raw)
    } catch {
      // 忽略损坏的窗口状态
    }

    mainWindow = new BrowserWindow({
      width: bounds?.width ?? 1280,
      height: bounds?.height ?? 820,
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: '画廊',
      titleBarStyle: 'hiddenInset',
      backgroundColor: darkAtBoot ? '#1C1916' : '#FAF8F5',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) app.quit()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('will-quit', () => {
    closeWatcher()
    disposeThumbResources()
    closeDb()
  })
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
