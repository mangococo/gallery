/** piexifjs 无官方类型，仅声明 gen-demo 用到的 API */
declare module 'piexifjs' {
  export const GPSIFD: Record<string, number>
  export const ExifIFD: Record<string, number>
  export function dump(data: {
    '0th'?: Record<string, unknown>
    Exif?: Record<string, unknown>
    GPS?: Record<string, unknown>
   Interop?: Record<string, unknown>
    '1st'?: Record<string, unknown>
  }): string
  export function insert(exifBytes: string, dataUrl: string): string
}
