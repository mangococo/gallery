/** 按扩展名判断是否媒体文件（拖拽过滤用，渲染进程读不到完整 MIME） */
export function hasMediaExt(name: string): boolean {
  return /\.(jpe?g|png|gif|bmp|webp|heic|tiff|mp4|m4v|mov|avi|mkv|webm)$/i.test(name)
}
