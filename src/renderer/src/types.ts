import type { PhotoDTO, TripDTO } from '@shared/types'

export type {
  Album,
  AlbumStatus,
  Bootstrap,
  CreateTripInput,
  JournalFormat,
  LegacyImportResult,
  PhotoDTO,
  PhotoType,
  ScanProgress,
  SearchHit,
  SearchMatchIn,
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
