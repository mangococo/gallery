// 主进程与渲染进程共享的领域类型与 IPC 通道定义

export type ThemeMode = 'light' | 'dark' | 'system'
export type AlbumStatus = 'ok' | 'missing'
export type PhotoType = 'image' | 'video'
export type ThumbStatus = 'pending' | 'ready' | 'failed'

/** 相册（一个照片根目录的注册记录） */
export interface Album {
  id: string
  name: string
  path: string
  status: AlbumStatus
  createdAt: number
}

/** 照片/视频 DTO：mediaUrl 与 thumbUrl 由主进程生成，渲染进程不接触真实路径 */
export interface PhotoDTO {
  id: string
  tripId: string
  fileName: string
  relPath: string
  type: PhotoType
  caption: string
  width: number | null
  height: number | null
  thumbStatus: ThumbStatus
  takenAt: number | null
  isCover: boolean
  mediaUrl: string
  /** 缩略图 URL；空串表示尚未生成，渲染层回退到占位/原图 */
  thumbUrl: string
}

export interface TripDTO {
  id: string
  albumId: string
  folderName: string
  title: string
  description: string
  startDate: string // YYYY-MM-DD
  endDate: string
  isFavorite: boolean
  coverPhotoId: string | null
  tags: string[]
  createdAt: number
  updatedAt: number
  photos: PhotoDTO[]
}

export interface Stats {
  albums: number
  trips: number
  photos: number
  storageBytes: number
}

/** 扫描/缩略图生成进度（主进程推送） */
export interface ScanProgress {
  albumId: string
  albumName: string
  phase: 'scan' | 'thumb'
  done: number
  total: number
  label?: string
}

/** 启动引导：一次性取齐主题/相册/激活态，避免首帧闪烁 */
export interface Bootstrap {
  theme: ThemeMode
  systemDark: boolean
  albums: Album[]
  activeAlbumId: string | null
}

export interface CreateTripInput {
  title: string
  description: string
  startDate: string
  endDate: string
  tags: string[]
}

export interface TripPatch {
  title?: string
  description?: string
  startDate?: string
  endDate?: string
  tags?: string[]
  isFavorite?: boolean
}

export interface LegacyImportResult {
  album: Album
  trips: number
  photos: number
  skippedCaptions: number
}

export type Unsubscribe = () => void

/** 渲染进程可用的类型化 API（经 contextBridge 暴露） */
export interface GalleryApi {
  bootstrap(): Promise<Bootstrap>
  getStats(): Promise<Stats>

  listAlbums(): Promise<Album[]>
  /** 弹出目录选择器注册新相册并扫描 */
  registerAlbum(): Promise<Album | null>
  /** 仅解除注册，不删除任何文件 */
  removeAlbum(id: string): Promise<void>
  renameAlbum(id: string, name: string): Promise<Album>
  /** 重新定位缺失相册的目录并重扫 */
  relocateAlbum(id: string): Promise<Album | null>
  /** 手动重新扫描（增量校对） */
  rescanAlbum(id: string): Promise<ScanProgress | null>
  setActiveAlbum(id: string): Promise<void>
  getActiveAlbumId(): Promise<string | null>

  listTrips(albumId: string): Promise<TripDTO[]>
  getTrip(id: string): Promise<TripDTO | null>
  createTrip(input: CreateTripInput): Promise<TripDTO>
  updateTrip(id: string, patch: TripPatch): Promise<TripDTO>
  /** 移入废纸篓 */
  deleteTrip(id: string): Promise<void>

  /** 复制文件进旅行目录并入库 */
  importPhotos(tripId: string, paths: string[]): Promise<PhotoDTO[]>
  /** 移入废纸篓 */
  deletePhoto(photoId: string): Promise<void>
  setCaption(photoId: string, caption: string): Promise<void>
  setCover(tripId: string, photoId: string): Promise<void>

  getTheme(): Promise<ThemeMode>
  setTheme(mode: ThemeMode): Promise<void>

  /** 选择旧数据根目录并执行 .settings.json 迁移导入 */
  importLegacy(): Promise<LegacyImportResult | null>

  onScanProgress(cb: (p: ScanProgress) => void): Unsubscribe
  onFsChanged(cb: (p: { albumId: string }) => void): Unsubscribe
  onThemeSystemChanged(cb: (p: { systemDark: boolean }) => void): Unsubscribe

  /** 把拖拽进来的 File 换成磁盘绝对路径（仅 Electron 环境可用） */
  getPathForFile(file: File): string
}

/** IPC 通道名 */
export const IPC = {
  bootstrap: 'app:bootstrap',
  stats: 'app:stats',

  albumsList: 'albums:list',
  albumsRegister: 'albums:register',
  albumsRemove: 'albums:remove',
  albumsRename: 'albums:rename',
  albumsRelocate: 'albums:relocate',
  albumsRescan: 'albums:rescan',
  albumsSetActive: 'albums:set-active',
  albumsGetActive: 'albums:get-active',

  tripsList: 'trips:list',
  tripsGet: 'trips:get',
  tripsCreate: 'trips:create',
  tripsUpdate: 'trips:update',
  tripsDelete: 'trips:delete',

  photosImport: 'photos:import',
  photosDelete: 'photos:delete',
  photosSetCaption: 'photos:set-caption',
  photosSetCover: 'photos:set-cover',

  themeGet: 'theme:get',
  themeSet: 'theme:set',

  importLegacy: 'import:legacy',

  pushScanProgress: 'push:scan-progress',
  pushFsChanged: 'push:fs-changed',
  pushThemeSystemChanged: 'push:theme-system-changed',
} as const
