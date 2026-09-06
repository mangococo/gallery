import type { BrowserWindow } from 'electron'

/**
 * 主进程主动推送（扫描进度/文件变化/主题）的唯一目标窗口。
 * 必须显式跟踪：曾用 getAllWindows()[0] 取「首个窗口」——缩略图服务的视频截帧
 * 会创建一个隐藏窗口，之后数组首位不再是主窗口，推送全部发进隐藏窗口，
 * 渲染层从此收不到任何刷新（进度条冻结、删除后界面不更新）。
 */
let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}
