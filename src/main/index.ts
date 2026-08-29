import { app, BrowserWindow, Menu, nativeTheme, type MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { registerMediaScheme, attachMediaProtocol, ensureThumbsDir } from './protocol'
import { registerIpcHandlers } from './ipc'
import { runE2EIfEnabled } from './e2e'

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

  app.whenReady().then(async () => {
    attachMediaProtocol({
      // M1 阶段数据层未就绪，一律返回 null（渲染层拿不到文件）
      async resolveAlbumRoot() {
        return null
      },
      thumbsDir() {
        return join(app.getPath('userData'), 'thumbnails')
      },
    })
    await ensureThumbsDir()

    registerIpcHandlers()
    installChineseMenu()

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: '画廊',
      titleBarStyle: 'hiddenInset',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1916' : '#FAF8F5',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    mainWindow.once('ready-to-show', () => mainWindow?.show())
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
