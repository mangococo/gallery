import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/types'
import type {
  GalleryApi,
  ScanProgress,
  ThemeMode,
  Unsubscribe,
} from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: GalleryApi = {
  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap),
  getStats: () => ipcRenderer.invoke(IPC.stats),

  listAlbums: () => ipcRenderer.invoke(IPC.albumsList),
  registerAlbum: () => ipcRenderer.invoke(IPC.albumsRegister),
  removeAlbum: (id) => ipcRenderer.invoke(IPC.albumsRemove, id),
  renameAlbum: (id, name) => ipcRenderer.invoke(IPC.albumsRename, id, name),
  relocateAlbum: (id) => ipcRenderer.invoke(IPC.albumsRelocate, id),
  rescanAlbum: (id) => ipcRenderer.invoke(IPC.albumsRescan, id),
  setActiveAlbum: (id) => ipcRenderer.invoke(IPC.albumsSetActive, id),
  getActiveAlbumId: () => ipcRenderer.invoke(IPC.albumsGetActive),

  listTrips: (albumId) => ipcRenderer.invoke(IPC.tripsList, albumId),
  getTrip: (id) => ipcRenderer.invoke(IPC.tripsGet, id),
  createTrip: (input) => ipcRenderer.invoke(IPC.tripsCreate, input),
  updateTrip: (id, patch) => ipcRenderer.invoke(IPC.tripsUpdate, id, patch),
  deleteTrip: (id) => ipcRenderer.invoke(IPC.tripsDelete, id),

  listTags: () => ipcRenderer.invoke(IPC.tagsList),

  importPhotos: (tripId, paths) => ipcRenderer.invoke(IPC.photosImport, tripId, paths),
  deletePhoto: (photoId) => ipcRenderer.invoke(IPC.photosDelete, photoId),
  setCaption: (photoId, caption) => ipcRenderer.invoke(IPC.photosSetCaption, photoId, caption),
  setCover: (tripId, photoId) => ipcRenderer.invoke(IPC.photosSetCover, tripId, photoId),
  setPhotoFavorite: (photoId, favorite) => ipcRenderer.invoke(IPC.photosSetFavorite, photoId, favorite),
  setPhotoTags: (photoId, tags) => ipcRenderer.invoke(IPC.photosSetTags, photoId, tags),

  getTheme: () => ipcRenderer.invoke(IPC.themeGet),
  setTheme: (mode: ThemeMode) => ipcRenderer.invoke(IPC.themeSet, mode),

  importLegacy: () => ipcRenderer.invoke(IPC.importLegacy),

  searchTrips: (albumId: string, q: string) => ipcRenderer.invoke(IPC.searchTrips, albumId, q),

  onScanProgress: (cb: (p: ScanProgress) => void) => subscribe(IPC.pushScanProgress, cb),
  onFsChanged: (cb) => subscribe(IPC.pushFsChanged, cb),
  onThemeSystemChanged: (cb) => subscribe(IPC.pushThemeSystemChanged, cb),

  getPathForFile: (file: File) => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('api', api)
