/** heic-decode 无官方类型：HEIC → RGBA 原始像素（libheif WASM） */
declare module 'heic-decode' {
  export interface DecodedHeic {
    width: number
    height: number
    data: Buffer
  }
  export default function decodeHeic(opts: { buffer: Buffer }): Promise<DecodedHeic>
}
