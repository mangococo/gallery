import type { GalleryApi, PhotoDTO } from '@shared/types'

declare global {
  interface Window {
    api: GalleryApi
  }
}

export const api: GalleryApi = window.api

/**
 * 列表/堆叠用展示源：仅缩略图（就绪时）；未就绪一律返回空串，由调用方渲染占位。
 * 不再回退原图——首扫期间几百张 pending 原图并发解码会把渲染/主进程同时打满（#3）；
 * 原图只在灯箱单张查看时经 photo.mediaUrl 加载。
 */
export function displaySrc(photo: PhotoDTO): string {
  return photo.thumbStatus === 'ready' && photo.thumbUrl ? photo.thumbUrl : ''
}
