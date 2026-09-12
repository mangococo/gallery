import React from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { displaySrc } from '../lib/api'
import { wgs84ToGcj02 } from '@shared/geo'
import { Photo } from '../types'
import { MapPinIcon } from './icons'

interface MapViewProps {
  photos: Photo[]
  /** 点击照片标记：打开灯箱并定位到该照片 */
  onOpenPhoto: (photo: Photo) => void
}

/**
 * 瓦片源清单（#6）：按序尝试 + 失败自动回退，全部为 WGS-84 源
 * （与 EXIF GPS 同坐标系，无需 GCJ-02 偏移；geo.ts 的换算保留给未来接入
 * 高德/腾讯等 GCJ-02 源时使用——届时把源的 gcj02 置 true 即可）。
 * - esri：Esri World Imagery 卫星影像。免 Key、国内无代理网络实测可达，
 *   且 Esri 的街道/地形底图在中国区域返回「Map data not yet available」
 *   占位瓦片，卫星影像是 Esri 系里唯一覆盖国内的图层 → 默认源。
 * - osm：OpenStreetMap 官方瓦片（国内通常不可达，境外网络生效），兜底。
 * 已排除（2026-09 实测）：CARTO 无 Key 瓦片带满幅「API KEY REQUIRED」
 * 水印；高德/腾讯公开栅格端点返回空白占位瓦片；Esri 街道/地形国内无数据。
 */
const TILE_SOURCES = [
  {
    id: 'esri',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    subdomains: 'abc',
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
    gcj02: false,
  },
  {
    id: 'osm',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    gcj02: false,
  },
] as const

/** 记住上次可用的瓦片源（会话级 localStorage，下次直接从它起步） */
const MAP_SOURCE_KEY = 'gallery.map_source'
function initialSourceIndex(): number {
  try {
    const saved = localStorage.getItem(MAP_SOURCE_KEY)
    const idx = TILE_SOURCES.findIndex((s) => s.id === saved)
    if (idx >= 0) return idx
  } catch {
    // 隐私模式读不到就算了
  }
  return 0
}

/**
 * 旅行地图视图：照片缩略图标记 + 自适应瓦片源（高德 → OSM 自动回退）。
 * 无坐标照片给空态引导；所有源都失败（离线）降级为提示条，标记仍可交互。
 * 标记用 L.divIcon 内联 HTML 渲染缩略图，避开 Leaflet 默认图标的打包路径问题。
 */
const MapView: React.FC<MapViewProps> = ({ photos, onOpenPhoto }) => {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<L.Map | null>(null)
  const markersRef = React.useRef<L.Marker[]>([])
  const [tilesFailed, setTilesFailed] = React.useState(false)
  /** 当前生效的瓦片源（标记坐标按其坐标系换算） */
  const [sourceIndex, setSourceIndex] = React.useState(initialSourceIndex)
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

    const attachLayer = (idx: number): void => {
      const src = TILE_SOURCES[idx]
      const layer = L.tileLayer(src.url, {
        maxZoom: src.maxZoom,
        subdomains: src.subdomains as unknown as string | string[],
        attribution: src.attribution,
      })
      let loaded = 0
      let errors = 0
      // 早期判死：连错 3 张且一张没成 → 立即换源；全部源耗尽 → 降级提示
      layer.on('tileload', () => {
        loaded++
        try {
          localStorage.setItem(MAP_SOURCE_KEY, src.id)
        } catch {
          /* 忽略 */
        }
      })
      layer.on('tileerror', () => {
        errors++
        if (loaded === 0 && errors >= 3) {
          layer.remove()
          if (idx + 1 < TILE_SOURCES.length) {
            setSourceIndex(idx + 1)
            attachLayer(idx + 1)
          } else {
            setTilesFailed(true)
          }
        } else if (loaded > 0 && errors > 12) {
          // 部分可用但大面积失败（弱网）：保持现状，只提示
          setTilesFailed(true)
        }
      })
      layer.addTo(map)
    }
    attachLayer(sourceIndex)

    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoPhotos.length > 0])

  // 照片集合变化时重建标记（如导入/删除后）；GCJ-02 源上做显示层换算
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || geoPhotos.length === 0) return

    const project = (lat: number, lon: number): [number, number] =>
      TILE_SOURCES[sourceIndex].gcj02 ? wgs84ToGcj02(lat, lon) : [lat, lon]

    for (const m of markersRef.current) m.remove()
    markersRef.current = []

    const bounds: [number, number][] = []
    for (const p of geoPhotos) {
      const latlng = project(p.gpsLat!, p.gpsLon!)
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
  }, [geoPhotos, sourceIndex])

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
