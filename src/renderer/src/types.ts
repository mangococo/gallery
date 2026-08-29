import type { PhotoDTO, TripDTO } from '@shared/types'

export type {
  Album,
  AlbumStatus,
  Bootstrap,
  CreateTripInput,
  LegacyImportResult,
  PhotoDTO,
  PhotoType,
  ScanProgress,
  Stats,
  ThemeMode,
  ThumbStatus,
  TripDTO,
  TripPatch,
  Unsubscribe,
} from '@shared/types'

/** 兼容旧组件命名 */
export type Trip = TripDTO
export type Photo = PhotoDTO
