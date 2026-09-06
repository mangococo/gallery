/**
 * 照片移动的纯决策层：不依赖 db / electron / fs，可单元测试。
 * ipc.ts 只做 IO 与入库，这里负责「移不移 / 移成什么名 / 封面交给谁」。
 */

export interface MovePhotoFact {
  id: string
  /** 所属旅行的相册 id（校验跨相册移动用） */
  albumId: string
  tripId: string
  fileName: string
  relPath: string
}

export interface ValidatedMove {
  /** 按入参顺序去重后的待移动照片 */
  photos: MovePhotoFact[]
  /** 与目标旅行相同的照片（原地不动，静默跳过） */
  skippedSameTrip: string[]
  /** 参与移动的源旅行 id 集合 */
  sourceTripIds: Set<string>
}

/**
 * 移动前校验：
 * - 空 / 目标缺失由调用方保证，这里假设 targetAlbumId、targetTripId 有效
 * - 目标旅行相同的照片跳过（同一旅行内「移动」是无意义操作）
 * - 不同相册的照片不能一起移（跨相册涉及跨卷 rename 与另一套 watcher，明确拒绝）
 * 抛 Error 的场景即用户可见错误（中文文案直出）。
 */
export function validateMovePhotos(
  photos: MovePhotoFact[],
  targetAlbumId: string,
  targetTripId: string,
): ValidatedMove {
  const seen = new Set<string>()
  const valid: MovePhotoFact[] = []
  const skippedSameTrip: string[] = []
  for (const p of photos) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    if (p.tripId === targetTripId) {
      skippedSameTrip.push(p.id)
      continue
    }
    if (p.albumId !== targetAlbumId) {
      throw new Error('不能把照片移动到其他相册的旅行（请先在同一相册内操作）')
    }
    valid.push(p)
  }
  return {
    photos: valid,
    skippedSameTrip,
    sourceTripIds: new Set(valid.map((p) => p.tripId)),
  }
}

/**
 * 目标目录内的落地文件名：与导入照片同一约定——重名加毫秒时间戳前缀；
 * 极端同毫秒冲突时再加序号（1000_a.jpg 被占 → 1000_2_a.jpg）。
 * exists 查询大小写不敏感（macOS APFS 默认大小写不敏感，库内文件名对比也如此）。
 */
export function collisionSafeDestName(
  fileName: string,
  exists: (name: string) => boolean,
  now = Date.now(),
): string {
  if (!exists(fileName.toLowerCase())) return fileName
  let candidate = `${now}_${fileName}`
  let i = 2
  while (exists(candidate.toLowerCase())) {
    candidate = `${now}_${i}_${fileName}`
    i++
  }
  return candidate
}

export interface SourceTripFact {
  tripId: string
  coverPhotoId: string | null
  /** 移动后仍留在该旅行的照片 id（按展示顺序） */
  remainingPhotoIds: string[]
}

export interface CoverReassignment {
  tripId: string
  /** 新封面（null = 清空，时间线自然回退到无封面态） */
  coverPhotoId: string | null
}

/**
 * 被抽走封面的源旅行补封面：封面随照片移走时，交给剩下的第一张；
 * 一张不剩则清空。未受影响的旅行原样保留（不产生条目）。
 */
export function planCoverReassignment(
  sourceTrips: SourceTripFact[],
  movedIds: Set<string>,
): CoverReassignment[] {
  const out: CoverReassignment[] = []
  for (const t of sourceTrips) {
    if (!t.coverPhotoId || !movedIds.has(t.coverPhotoId)) continue
    out.push({
      tripId: t.tripId,
      coverPhotoId: t.remainingPhotoIds[0] ?? null,
    })
  }
  return out
}
