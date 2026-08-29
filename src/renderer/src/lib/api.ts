import type { GalleryApi, PhotoDTO } from '@shared/types'

declare global {
  interface Window {
    api: GalleryApi
  }
}

export const api: GalleryApi = window.api

/** 列表/堆叠用展示源：优先缩略图，未就绪回退原图（视频无缩略图时返回空串） */
export function displaySrc(photo: PhotoDTO): string {
  if (photo.thumbStatus === 'ready' && photo.thumbUrl) return photo.thumbUrl
  return photo.type === 'image' ? photo.mediaUrl : ''
}
