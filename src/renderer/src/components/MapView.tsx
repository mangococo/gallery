import React from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { displaySrc } from '../lib/api'
import { Photo } from '../types'
import { MapPinIcon } from './icons'

interface MapViewProps {
  photos: Photo[]
  /** 点击照片标记：打开灯箱并定位到该照片 */
  onOpenPhoto: (photo: Photo) => void
}

/**
 * 旅行地图视图：OSM 瓦片（联网加载，带 attribution）+ 照片缩略图标记。
 * 无坐标照片给空态引导；瓦片加载失败（离线）降级为提示条，标记仍可交互。
 * 标记用 L.divIcon 内联 HTML 渲染缩略图，避开 Leaflet 默认图标的打包路径问题。
 */
const MapView: React.FC<MapViewProps> = ({ photos, onOpenPhoto }) => {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<L.Map | null>(null)
  const markersRef = React.useRef<L.Marker[]>([])
  const [tilesFailed, setTilesFailed] = React.useState(false)
  const openPhotoRef = React.useRef(onOpenPhoto)
  openPhotoRef.current = onOpenPhoto

  const geoPhotos = React.useMemo(
    () => photos.filter((p) => p.gpsLat != null && p.gpsLon != null),
    [photos],
  )

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current || geoPhotos.length === 0) return

    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true })
    mapRef.current = map

    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // OSM 官方署名要求（瓦片与署名不可分离）
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    })
    tiles.on('tileerror', () => setTilesFailed(true))
    tiles.addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoPhotos.length > 0])

  // 照片集合变化时重建标记（如导入/删除后）
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || geoPhotos.length === 0) return

    for (const m of markersRef.current) m.remove()
    markersRef.current = []

    const bounds: [number, number][] = []
    for (const p of geoPhotos) {
      const latlng: [number, number] = [p.gpsLat!, p.gpsLon!]
      bounds.push(latlng)
      const src = displaySrc(p)
      const label = p.caption || p.fileName
      const icon = L.divIcon({
        className: 'map-marker-wrap',
        html: `<div class="map-marker" title="${label.replace(/"/g, '&quot;')}">${
          src ? `<img src="${src}" alt="" draggable="false"/>` : '<span></span>'
        }</div>`,
        iconSize: [48, 54],
        iconAnchor: [24, 52],
      })
      const marker = L.marker(latlng, { icon, title: label, keyboard: false })
      marker.on('click', () => openPhotoRef.current(p))
      marker.addTo(map)
      markersRef.current.push(marker)
    }

    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 })
  }, [geoPhotos])

  if (geoPhotos.length === 0) {
    return (
      <div className="h-[520px] rounded-xl border border-line bg-surface flex flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="text-ink-3">
          <MapPinIcon size={36} />
        </span>
        <p className="font-display text-lg text-ink-2">这次旅行还没有带位置的照片</p>
        <p className="text-sm text-ink-3 leading-relaxed max-w-md">
          带有 GPS 信息的照片会自动落在地图上。相机/手机拍摄的原片通常自带位置；
          从聊天工具转存过的图片可能会丢失。
        </p>
      </div>
    )
  }

  return (
    // z-0 建立独立层叠上下文：Leaflet 内部 pane 的 z-index（400+）不能盖过灯箱等 z-50 弹层
    <div className="relative z-0 rounded-xl overflow-hidden border border-line">
      <div ref={containerRef} className="h-[520px] bg-surface-2" />
      {tilesFailed && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] px-4 py-2 rounded-full bg-surface border border-line shadow-lg text-sm text-ink-2">
          地图瓦片加载失败（可能离线）——照片标记仍可点击查看
        </div>
      )}
      <div className="absolute bottom-1 right-2 z-[500] text-[10px] text-ink-3 bg-surface/80 rounded px-1.5 py-0.5">
        {geoPhotos.length} 张定位照片
      </div>
    </div>
  )
}

export default MapView
