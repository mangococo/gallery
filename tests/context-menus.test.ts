import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildEmptyAreaMenu,
  buildPhotoBatchMenu,
  buildPhotoMenu,
  buildTripMenu,
  revealInLabel,
} from '../src/renderer/src/lib/context-menus.ts'
import type { Photo, Trip } from '../src/renderer/src/types.ts'

function photo(partial: Partial<Photo> & { id: string }): Photo {
  return {
    tripId: 't1',
    fileName: `${partial.id}.jpg`,
    relPath: `t1/${partial.id}.jpg`,
    type: 'image',
    caption: '',
    width: 100,
    height: 100,
    thumbStatus: 'ready',
    takenAt: 1700000000000,
    isCover: false,
    favorite: false,
    tags: [],
    gpsLat: null,
    gpsLon: null,
    mediaUrl: 'x://m',
    thumbUrl: 'x://t',
    ...partial,
  }
}

function trip(partial: Partial<Trip> & { id: string }): Trip {
  return {
    albumId: 'a1',
    folderName: 'f',
    title: '旅行',
    description: '',
    startDate: '2026-01-01',
    endDate: '2026-01-02',
    isFavorite: false,
    coverPhotoId: null,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    status: 'ok',
    photos: [],
    ...partial,
  }
}

const H = {
  onOpen: () => {},
  onEditCaption: () => {},
  onEditTags: () => {},
  onToggleFavorite: () => {},
  onBatchFavorite: () => {},
  onSetCover: () => {},
  onMove: () => {},
  onReveal: () => {},
  onCopyPath: () => {},
  onDelete: () => {},
  onEnterSelect: () => {},
}

const labels = (entries: { kind?: string; label?: string }[]): string[] =>
  entries.map((e) => e.label).filter((l): l is string => typeof l === 'string')

test('buildPhotoMenu：图片单选包含完整操作集与危险删除', () => {
  const entries = buildPhotoMenu(photo({ id: 'p1' }), H, {}, { canSelect: true, isMac: true })
  const ls = labels(entries)
  assert.ok(ls.includes('打开查看'))
  assert.ok(ls.includes('编辑图注'))
  assert.ok(ls.includes('添加标签'))
  assert.ok(ls.includes('加入收藏'))
  assert.ok(ls.includes('设为旅行封面'))
  assert.ok(ls.includes('移动到旅行…'))
  assert.ok(ls.includes(revealInLabel(true)))
  assert.ok(ls.includes('复制文件路径'))
  assert.ok(ls.includes('选择多张…'))
  const del = entries.find((e) => e.kind !== 'separator' && e.label?.includes('删除'))
  assert.ok(del && 'danger' in del && del.danger)
})

test('buildPhotoMenu：视频文案与已收藏/已封面态', () => {
  const entries = buildPhotoMenu(
    photo({ id: 'v1', type: 'video', favorite: true }),
    H,
    {},
    { canSelect: false, isCover: true, isMac: false },
  )
  const ls = labels(entries)
  assert.ok(ls.includes('播放视频'))
  assert.ok(ls.includes('取消收藏'))
  assert.ok(ls.includes('已设为封面'))
  assert.ok(ls.includes('删除视频（移入废纸篓）'))
  assert.ok(!ls.includes('选择多张…'))
  // 已是封面 → 设为封面应禁用
  const coverItem = entries.find((e) => 'label' in e && e.label === '已设为封面')
  assert.ok(coverItem && 'disabled' in coverItem && coverItem.disabled)
})

test('buildPhotoMenu：带标签的照片显示标签计数', () => {
  const entries = buildPhotoMenu(photo({ id: 'p1', tags: ['雪山', '黄昏'] }), H)
  assert.ok(labels(entries).includes('编辑标签（2）'))
})

test('buildPhotoMenu：Windows 平台文案切换', () => {
  assert.equal(revealInLabel(false), '在资源管理器中显示')
  assert.equal(revealInLabel(true), '在 Finder 中显示')
})

test('buildPhotoBatchMenu：多选菜单以数量开头、收藏随整体态切换', () => {
  const mixed = buildPhotoBatchMenu(
    [photo({ id: 'p1', favorite: true }), photo({ id: 'p2' })],
    H,
  )
  assert.equal(mixed[0].kind, 'header')
  assert.equal((mixed[0] as { label: string }).label, '已选择 2 项（含 0 个视频）')
  assert.ok(labels(mixed).includes('收藏全部'))

  const allFav = buildPhotoBatchMenu(
    [photo({ id: 'p1', favorite: true }), photo({ id: 'p2', favorite: true })],
    H,
  )
  assert.ok(labels(allFav).includes('取消全部收藏'))
  assert.ok(labels(allFav).includes('删除 2 项（移入废纸篓）'))
})

test('buildPhotoBatchMenu：含视频的多选在 header 标注', () => {
  const entries = buildPhotoBatchMenu(
    [photo({ id: 'p1' }), photo({ id: 'v1', type: 'video' })],
    H,
  )
  assert.match((entries[0] as { label: string }).label, /含 1 个视频/)
})

test('buildTripMenu：正常旅行完整菜单', () => {
  const entries = buildTripMenu(trip({ id: 't1' }), {
    onOpen: () => {},
    onEdit: () => {},
    onImport: () => {},
    onToggleFavorite: () => {},
    onRescan: () => {},
    onDelete: () => {},
  })
  const ls = labels(entries)
  assert.deepEqual(ls, [
    '打开旅行',
    '编辑旅行信息',
    '导入照片到这次旅行…',
    '收藏旅行',
    '重新扫描相册',
    '删除旅行…',
  ])
})

test('buildTripMenu：missing 旅行收窄为安全集（打开/编辑/导入禁用，删除变只清记录）', () => {
  const entries = buildTripMenu(trip({ id: 't1', status: 'missing' }), {
    onOpen: () => {},
    onEdit: () => {},
    onImport: () => {},
    onToggleFavorite: () => {},
    onRescan: () => {},
    onDelete: () => {},
  })
  const open = entries.find((e) => 'label' in e && e.label === '打开旅行')
  const edit = entries.find((e) => 'label' in e && e.label === '编辑旅行信息')
  const imp = entries.find((e) => 'label' in e && e.label === '导入照片到这次旅行…')
  assert.ok(open && 'disabled' in open && open.disabled)
  assert.ok(edit && 'disabled' in edit && edit.disabled)
  assert.ok(imp && 'disabled' in imp && imp.disabled)
  assert.ok(labels(entries).includes('删除记录（文件夹已缺失）'))
})

test('buildEmptyAreaMenu：旅行页与首页的场景差异', () => {
  const tripPage = buildEmptyAreaMenu('trip-page', { onAddPhotos: () => {}, onRescan: () => {}, onRefresh: () => {} })
  const lsTrip = labels(tripPage)
  assert.ok(lsTrip.includes('添加照片…'))
  assert.ok(!lsTrip.includes('新建旅行…'))
  assert.ok(lsTrip.includes('重新扫描相册'))
  assert.ok(lsTrip.includes('刷新'))

  const home = buildEmptyAreaMenu('home', { onNewTrip: () => {}, onRescan: () => {}, onRefresh: () => {} })
  const lsHome = labels(home)
  assert.ok(lsHome.includes('新建旅行…'))
  assert.ok(!lsHome.includes('添加照片…'))
})
