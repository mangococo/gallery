import { ipcMain } from 'electron'
import { IPC } from '../shared/types'

/**
 * IPC 处理器注册。
 * M1 阶段为空数据存根；M2 起接入 SQLite 数据层。
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.bootstrap, () => ({
    theme: 'system',
    systemDark: false,
    albums: [],
    activeAlbumId: null,
  }))
  ipcMain.handle(IPC.stats, () => ({ albums: 0, trips: 0, photos: 0, storageBytes: 0 }))

  ipcMain.handle(IPC.albumsList, () => [])
  ipcMain.handle(IPC.albumsRegister, () => null)
  ipcMain.handle(IPC.albumsRemove, () => undefined)
  ipcMain.handle(IPC.albumsRename, () => null)
  ipcMain.handle(IPC.albumsRelocate, () => null)
  ipcMain.handle(IPC.albumsRescan, () => null)
  ipcMain.handle(IPC.albumsSetActive, () => undefined)
  ipcMain.handle(IPC.albumsGetActive, () => null)

  ipcMain.handle(IPC.tripsList, () => [])
  ipcMain.handle(IPC.tripsGet, () => null)
  ipcMain.handle(IPC.tripsCreate, () => {
    throw new Error('数据层尚未就绪')
  })
  ipcMain.handle(IPC.tripsUpdate, () => {
    throw new Error('数据层尚未就绪')
  })
  ipcMain.handle(IPC.tripsDelete, () => undefined)

  ipcMain.handle(IPC.photosImport, () => [])
  ipcMain.handle(IPC.photosDelete, () => undefined)
  ipcMain.handle(IPC.photosSetCaption, () => undefined)
  ipcMain.handle(IPC.photosSetCover, () => undefined)

  ipcMain.handle(IPC.themeGet, () => 'system')
  ipcMain.handle(IPC.themeSet, () => undefined)

  ipcMain.handle(IPC.importLegacy, () => null)
}
