/**
 * HEIF 家族内容嗅探（纯函数，无 electron/sharp 依赖，node --test 直接测）。
 *
 * 背景：微信等 IM 转存的图片常见「HEIC 内容 + .jpg 扩展名」。sharp 预编译的 libheif
 * 无 HEVC 解码插件，这类文件走 sharp 必失败；WASM 回退（heic-decode）能解，但旧逻辑
 * 按扩展名（.heic/.heif/.hif）决定是否回退，伪装扩展名会漏网 → 缩略图/大图双失败。
 * 修复：解码器分流以内容为准——读文件头按 ISOBMFF ftyp box 的 brand 判定。
 */

/** 读文件头做嗅探的窗口长度（常见 ftyp box 24-32 字节，64 留余量） */
export const HEIF_SNIFF_BYTES = 64

/**
 * HEIF 相关 brand（不含 avif/avis：sharp 预编译自带 AV1 解码，走原生管线即可；
 * 若 avif 文件 sharp 也失败，WASM 的 libde265 同样解不了 AV1，回退无意义）。
 * mif1/msf1 是 HEIF 容器通用 brand，iPhone 照片 major=mif1、compatible 含 heic。
 */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heif'])

/** AVIF 容器 major brand：其 compatible brands 必含 mif1（同源于 HEIF 容器），需显式排除 */
const AVIF_BRANDS = new Set(['avif', 'avis'])

const brand = (buf: Buffer, off: number): string => buf.toString('latin1', off, off + 4)

/**
 * 判定文件头字节是否 HEIF 家族。ISOBMFF 规范要求 ftyp 是第一个 box：
 *   bytes 0-3   box size（uint32 BE，含自身）
 *   bytes 4-7   'ftyp'
 *   bytes 8-11  major brand
 *   bytes 12-15 minor version
 *   bytes 16..  compatible brands（到 box size 为止）
 * major 或任一 compatible brand 命中 HEIF 集合即认定为 HEIF。
 * box size 畸形（超出给定字节）时只扫已有部分，不误判。
 */
export function isHeifBuffer(head: Buffer): boolean {
  if (head.length < 12) return false
  if (brand(head, 4) !== 'ftyp') return false
  const major = brand(head, 8)
  if (AVIF_BRANDS.has(major)) return false
  const boxSize = head.readUInt32BE(0)
  const end = Math.min(boxSize, head.length)
  if (HEIF_BRANDS.has(major)) return true
  for (let off = 16; off + 4 <= end; off += 4) {
    if (HEIF_BRANDS.has(brand(head, off))) return true
  }
  return false
}
