import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../lib/store'
import { Trip } from '../types'
import TimelineItem from '../components/TimelineItem'
import TimelineAddButton from '../components/TimelineAddButton'
import AddTripModal from '../components/AddTripModal'
import { confirmAndDeleteTrip } from '../lib/trip-actions'
import { HeartIcon, PlusIcon, XIcon } from '../components/icons'

const HomePage: React.FC = () => {
  const navigate = useNavigate()
  const { albums, activeAlbumId, trips, filters, setFilters, refreshAll } = useApp()
  const [showAddModal, setShowAddModal] = React.useState(false)
  /** 删除确认弹窗打开期间锁住，防重复点击 */
  const [deletingTripId, setDeletingTripId] = React.useState<string | null>(null)

  const activeAlbum = albums.find((a) => a.id === activeAlbumId) ?? null

  // 应用筛选和排序（开始日期倒序 + 标签/收藏/年份叠加）
  const filteredTrips = React.useMemo(() => {
    let filtered = [...trips]
    filtered.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))

    if (filters.favoritesOnly) {
      filtered = filtered.filter((t) => t.isFavorite)
    }
    if (filters.tags.length > 0) {
      filtered = filtered.filter((t) => t.tags.some((tag) => filters.tags.includes(tag)))
    }
    if (filters.year) {
      filtered = filtered.filter((t) => (t.startDate || '').slice(0, 4) === filters.year)
    }
    return filtered
  }, [trips, filters])

  const photoTotal = React.useMemo(
    () => filteredTrips.reduce((acc, t) => acc + (t.photos?.length || 0), 0),
    [filteredTrips],
  )

  const activeFilterChips: { label: string; icon?: 'heart'; clear: () => void }[] = [
    ...(filters.favoritesOnly
      ? [{ label: '收藏', icon: 'heart' as const, clear: () => setFilters({ favoritesOnly: false }) }]
      : []),
    ...filters.tags.map((tag) => ({
      label: `#${tag}`,
      clear: () => setFilters({ tags: filters.tags.filter((t) => t !== tag) }),
    })),
    ...(filters.year
      ? [{ label: filters.year + ' 年', clear: () => setFilters({ year: null }) }]
      : []),
  ]

  const handleTripAdded = async () => {
    await refreshAll()
  }

  const handleToggleFavorite = async (tripId: string) => {
    const trip = trips.find((t) => t.id === tripId)
    if (!trip) return
    await window.api.updateTrip(tripId, { isFavorite: !trip.isFavorite })
    await refreshAll()
  }

  /** 首次点击缺失旅行的确认弹窗期间锁住，防重复触发 */
  const [openingTripId, setOpeningTripId] = React.useState<string | null>(null)

  /**
   * 点击旅行 = 打开旅行页；但文件夹已被移出相册目录的旅行（status === 'missing'）
   * 打开只会看到一堆失效图片——首次点击即提示是否删除该旅行记录，取消则留在首页。
   */
  const handleOpenTrip = async (tripId: string) => {
    const trip = trips.find((t) => t.id === tripId)
    if (!trip) return
    if (trip.status === 'missing') {
      if (openingTripId) return
      setOpeningTripId(tripId)
      const deleted = await confirmAndDeleteTrip({
        id: trip.id,
        title: trip.title,
        photoCount: trip.photos?.length || 0,
        status: trip.status,
      })
      if (deleted) await refreshAll()
      setOpeningTripId(null)
      return
    }
    navigate(`/trip/${tripId}`)
  }

  const handleDeleteTrip = async (tripId: string) => {
    if (deletingTripId) return
    const trip = trips.find((t) => t.id === tripId)
    if (!trip) return
    setDeletingTripId(tripId)
    const deleted = await confirmAndDeleteTrip({
      id: trip.id,
      title: trip.title,
      photoCount: trip.photos?.length || 0,
      status: trip.status,
    })
    if (deleted) await refreshAll()
    setDeletingTripId(null)
  }

  return (
    <div className="min-h-screen">
      {/* 内容区顶栏（可拖拽） */}
      <header className="drag-region sticky top-0 z-10 h-12 bg-background/85 backdrop-blur-sm border-b border-line flex items-center justify-between pl-8 pr-5">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="font-display font-bold text-xl text-ink truncate">
            {activeAlbum ? activeAlbum.name : '画廊'}
          </h1>
          <span className="text-xs text-ink-3 whitespace-nowrap">
            {filteredTrips.length} 次旅行 · {photoTotal} 张照片
          </span>
          {activeFilterChips.length > 0 && (
            <div className="flex items-center gap-1.5 ml-2 no-drag">
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.label}
                  onClick={chip.clear}
                  className="px-2 py-0.5 bg-primary-soft text-primary text-xs rounded-full hover:opacity-80 transition-opacity flex items-center gap-1"
                >
                  {chip.icon === 'heart' && <HeartIcon size={11} filled />}
                  <span>{chip.label}</span>
                  <XIcon size={10} />
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="no-drag px-4 py-1.5 bg-primary text-white rounded-lg text-sm hover:opacity-90 transition-opacity shrink-0 flex items-center gap-1"
        >
          <PlusIcon size={13} />
          <span>新旅行</span>
        </button>
      </header>

      {/* 时间线 */}
      <div className="max-w-[880px] mx-auto px-10 py-12">
        <div className="relative">
          {filteredTrips.length > 0 && (
            <div className="stitch-line absolute left-[70px] top-3 bottom-0 w-[2px]" />
          )}

          <div className="relative">
            {filteredTrips.map((trip: Trip, index) => (
              <React.Fragment key={trip.id}>
                {index > 0 && <TimelineAddButton onAdd={() => setShowAddModal(true)} />}
                <TimelineItem
                  trip={trip}
                  onEdit={handleOpenTrip}
                  onToggleFavorite={handleToggleFavorite}
                  onDelete={handleDeleteTrip}
                />
              </React.Fragment>
            ))}
            {filteredTrips.length > 0 && (
              <TimelineAddButton onAdd={() => setShowAddModal(true)} />
            )}
          </div>

          {/* 空状态 */}
          {filteredTrips.length === 0 && trips.length > 0 && (
            <div className="text-center py-24">
              <p className="text-ink-3 mb-4 font-display text-lg">这一页还没有符合条件的旅行</p>
              <button
                onClick={() => setFilters({ favoritesOnly: false, tags: [], year: null })}
                className="px-6 py-2.5 bg-primary text-white rounded-xl hover:opacity-90 transition-opacity text-sm"
              >
                清除筛选
              </button>
            </div>
          )}

          {trips.length === 0 && (
            <div className="text-center py-24">
              <p className="text-ink-3 mb-2 font-display text-2xl">翻开第一页旅行手账</p>
              <p className="text-ink-3 text-sm mb-8">
                {activeAlbum
                  ? '点右上角「新旅行」，或把照片拖进窗口'
                  : '先在左侧「相册」点击加号注册照片目录'}
              </p>
              {activeAlbum && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-6 py-2.5 bg-primary text-white rounded-xl hover:opacity-90 transition-opacity text-sm"
                >
                  创建第一次旅行
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddTripModal onClose={() => setShowAddModal(false)} onSuccess={handleTripAdded} />
      )}
    </div>
  )
}

export default HomePage
