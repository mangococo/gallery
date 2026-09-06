/** 按扩展名判断是否媒体文件（拖拽过滤用，渲染进程读不到完整 MIME） */
export function hasMediaExt(name: string): boolean {
  return /\.(jpe?g|png|gif|bmp|webp|heic|tiff|mp4|m4v|mov|avi|mkv|webm)$/i.test(name)
}

/**
 * 封面优先排序：封面照片排到首位，其余保持原相对顺序。
 * 时间线堆叠/网格以封面为首张展示——「设为封面」必须在主视图立即生效，
 * 而不是只改一个徽标。封面不在列表（已删/跨旅行）时原样返回。
 */
export function coverFirstOrder<T extends { id: string }>(
  photos: T[],
  coverPhotoId: string | null | undefined,
): T[] {
  if (!coverPhotoId) return photos
  const cover = photos.find((p) => p.id === coverPhotoId)
  if (!cover) return photos
  return [cover, ...photos.filter((p) => p.id !== coverPhotoId)]
}
