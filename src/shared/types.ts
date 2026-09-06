// 主进程与渲染进程共享的领域类型与 IPC 通道定义

export type ThemeMode = 'light' | 'dark' | 'system'
export type AlbumStatus = 'ok' | 'missing'
/** 旅行文件夹在相册目录中的在位状态（磁盘实时校对，不落库） */
export type TripStatus = 'ok' | 'missing'
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
  favorite: boolean
  /** 照片级标签 */
  tags: string[]
  /** EXIF GPS 十进制度；null 表示无坐标 */
  gpsLat: number | null
  gpsLon: number | null
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
  /** 旅行文件夹是否还在相册目录中；missing 时点击应提示删除记录 */
  status: TripStatus
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

/** 移动照片的目标：已有旅行，或在流程内直接新建（主进程保证「建旅行+搬文件」一气呵成） */
export interface MoveTarget {
  tripId?: string
  createTrip?: CreateTripInput
}

/** photos:move 的结果 */
export interface MovePhotosResult {
  /** 成功移动的 photoId（含源文件已丢失、仅移动记录的） */
  movedIds: string[]
  /** 源文件在磁盘上已不存在、只移动了记录的数量 */
  fileMissingCount: number
  /** 移动后目标旅行（新建场景下即新旅行） */
  targetTrip: TripDTO
}

/** photos:import 返回：成功入库的照片 + 失败文件清单（源被移走/无权限等，不中断整批） */
export interface ImportPhotosResult {
  photos: PhotoDTO[]
  failed: { name: string; reason: string }[]
}

/** 手账导出格式：PDF（矢量可打印）或长图 PNG */
export type JournalFormat = 'pdf' | 'png'

/** ⌘K 搜索命中字段（photoTag = 照片级标签命中，聚合到所属旅行） */
export type SearchMatchIn = 'title' | 'description' | 'tags' | 'caption' | 'photoTag'

/** ⌘K 搜索结果：按旅行聚合（图注命中也归到所属旅行） */
export interface SearchHit {
  tripId: string
  title: string
  startDate: string
  tags: string[]
  /** 本次命中的字段，标题命中排最前 */
  matchedIn: SearchMatchIn[]
  description: string
  /** 命中的图注样例（渲染层做高亮） */
  sampleCaption: string | null
  /** 缩略图 URL：命中图注的照片优先，否则封面照片；'' 表示无可用缩略图 */
  thumbUrl: string
}

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

  /** 全部已有标签（常用在前），标签输入联想用 */
  listTags(): Promise<string[]>

  /** 复制文件进旅行目录并入库（单个失败不中断整批，见 ImportPhotosResult.failed） */
  importPhotos(tripId: string, paths: string[]): Promise<ImportPhotosResult>
  /** 移入废纸篓 */
  deletePhoto(photoId: string): Promise<void>
  setCaption(photoId: string, caption: string): Promise<void>
  setCover(tripId: string, photoId: string): Promise<void>
  /** 照片级收藏开关 */
  setPhotoFavorite(photoId: string, favorite: boolean): Promise<void>
  /** 照片级标签（覆盖式） */
  setPhotoTags(photoId: string, tags: string[]): Promise<void>
  /** 把照片/视频移动到其他旅行（支持目标为新建旅行；文件与库记录一起搬） */
  movePhotos(photoIds: string[], target: MoveTarget): Promise<MovePhotosResult>
  /** 在 Finder/资源管理器中显示照片所在文件 */
  revealPhotoInFolder(photoId: string): Promise<void>
  /** 把照片的磁盘绝对路径写入系统剪贴板，返回该路径 */
  copyPhotoPath(photoId: string): Promise<string>

  getTheme(): Promise<ThemeMode>
  setTheme(mode: ThemeMode): Promise<void>

  /** 选择旧数据根目录并执行 .settings.json 迁移导入 */
  importLegacy(): Promise<LegacyImportResult | null>

  /** ⌘K 搜索：旅行标题/描述/标签/图注/照片标签，按旅行聚合返回 */
  searchTrips(albumId: string, q: string): Promise<SearchHit[]>

  /** 导出手账（隐藏窗口渲染模板；返回保存路径，用户取消返回 null） */
  exportJournal(tripId: string, format: JournalFormat): Promise<string | null>

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
  tagsList: 'tags:list',

  photosImport: 'photos:import',
  photosDelete: 'photos:delete',
  photosSetCaption: 'photos:set-caption',
  photosSetCover: 'photos:set-cover',
  photosSetFavorite: 'photos:set-favorite',
  photosSetTags: 'photos:set-tags',
  photosMove: 'photos:move',
  photosReveal: 'photos:reveal',
  photosCopyPath: 'photos:copy-path',

  themeGet: 'theme:get',
  themeSet: 'theme:set',

  importLegacy: 'import:legacy',

  searchTrips: 'search:trips',

  journalsExport: 'journals:export',

  pushScanProgress: 'push:scan-progress',
  pushFsChanged: 'push:fs-changed',
  pushThemeSystemChanged: 'push:theme-system-changed',
} as const
