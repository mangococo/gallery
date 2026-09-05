/**
 * 生成验收截图用的演示数据（不进入应用运行时）：
 *  1. build/icon.png —— Windows 打包图标（由 build/icon.svg 渲染）
 *  2. 演示相册目录（4 个旅行 × 生成式风景照 + .settings.json 元数据）
 *  3. 演示 userData/gallery.db（预置浅色主题与窗口尺寸，schema 与 src/main/db.ts 一致）
 *
 * 用法：node scripts/gen-demo.mjs
 *       GALLERY_DEMO_LARGE=420 node scripts/gen-demo.mjs   # 额外生成 420 张的大相册旅行（性能验收用）
 * 产物：/tmp/gallery-demo/{album,userdata}
 */
import sharp from 'sharp'
import piexif from 'piexifjs'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import Database from 'better-sqlite3'

const ROOT = '/tmp/gallery-demo'
const ALBUM = join(ROOT, '我的旅行')
const USERDATA = join(ROOT, 'userdata')

// —— 确定性伪随机 ——
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W = 1600
const H = 1067

const svgWrap = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`

const lin = (id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops
    .map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op != null ? ` stop-opacity="${op}"` : ''}/>`)
    .join('')}</linearGradient>`

const vig = `<radialGradient id="vig" cx="0.5" cy="0.45" r="0.85">
  <stop offset="0.62" stop-color="#000" stop-opacity="0"/>
  <stop offset="1" stop-color="#000" stop-opacity="0.22"/>
</radialGradient>`

const vignette = `<rect width="${W}" height="${H}" fill="url(#vig)"/>`

/** 山脊折线：seed 决定起伏 */
function ridge(rng, baseY, amp, peaks, color, opacity = 1) {
  const pts = []
  const step = W / peaks
  for (let i = 0; i <= peaks; i++) {
    const x = i * step + (rng() - 0.5) * step * 0.4
    const y = baseY - rng() * amp - (i % 2 === 0 ? amp * 0.35 : 0)
    pts.push(`${x.toFixed(0)},${y.toFixed(0)}`)
  }
  return `<polygon points="0,${H} ${pts.join(' ')} ${W},${H}" fill="${color}" opacity="${opacity}"/>`
}

function cloud(rng, cx, cy, scale, opacity) {
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" opacity="${opacity}" filter="url(#soft)">
    <ellipse cx="0" cy="0" rx="120" ry="34" fill="#fff"/>
    <ellipse cx="-70" cy="12" rx="70" ry="24" fill="#fff"/>
    <ellipse cx="80" cy="14" rx="80" ry="26" fill="#fff"/>
  </g>`
}

const defsCommon = `
  ${vig}
  <filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="soft4" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4"/></filter>
  <filter id="soft30" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="30"/></filter>
`

// —— 场景：山峦日出/日落 ——
function mountains(seed, P) {
  const rng = mulberry32(seed)
  const sunX = W * (0.28 + rng() * 0.44)
  const sunY = H * (0.3 + rng() * 0.12)
  const defs = lin('sky', P.sky)
  return svgWrap(`<defs>${defs}${defsCommon}
    <radialGradient id="halo"><stop offset="0" stop-color="${P.glow}" stop-opacity="0.85"/><stop offset="1" stop-color="${P.glow}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="${sunX}" cy="${sunY}" r="260" fill="url(#halo)"/>
  <circle cx="${sunX}" cy="${sunY}" r="${52 + rng() * 22}" fill="${P.sun}" filter="url(#soft4)"/>
  ${cloud(rng, W * 0.22, H * 0.18, 1.4, 0.5)}
  ${cloud(rng, W * 0.7, H * 0.12, 1.0, 0.4)}
  ${ridge(rng, H * 0.62, 150, 5, P.far, 0.55)}
  <rect y="${H * 0.58}" width="${W}" height="60" fill="${P.haze}" opacity="0.5" filter="url(#soft30)"/>
  ${ridge(rng, H * 0.72, 170, 4, P.mid, 0.85)}
  ${ridge(rng, H * 0.86, 150, 3, P.near)}
  ${vignette}`)
}

// —— 场景：海面 ——
function sea(seed, P) {
  const rng = mulberry32(seed)
  const hor = H * (0.42 + rng() * 0.06)
  const sunX = W * (0.3 + rng() * 0.4)
  const defs = lin('sky', P.sky) + lin('water', P.water)
  const glints = Array.from({ length: 46 }, (_, i) => {
    const y = hor + 14 + (i / 46) ** 1.6 * (H - hor)
    const w = 30 + rng() * (140 + (y - hor) * 0.5)
    const x = sunX - w / 2 + (rng() - 0.5) * (y - hor) * 1.6
    return `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="3" rx="1.5" fill="${P.glint}" opacity="${(0.7 - (y - hor) / (H - hor) * 0.5).toFixed(2)}"/>`
  }).join('')
  const foam = Array.from({ length: 5 }, (_, i) => {
    const y = H - 30 - i * 26
    return `<path d="M0 ${y} Q ${W * 0.25} ${y - 12} ${W * 0.5} ${y} T ${W} ${y}" stroke="${P.foam}" stroke-width="${2 + i}" fill="none" opacity="${0.25 - i * 0.04}"/>`
  }).join('')
  return svgWrap(`<defs>${defs}${defsCommon}</defs>
  <rect width="${W}" height="${hor}" fill="url(#sky)"/>
  ${cloud(rng, W * 0.3, hor * 0.3, 1.6, 0.55)}
  ${cloud(rng, W * 0.72, hor * 0.2, 1.1, 0.45)}
  <ellipse cx="${W * 0.82}" cy="${hor - 8}" rx="180" ry="26" fill="${P.far}" opacity="0.6" filter="url(#soft)"/>
  <rect y="${hor}" width="${W}" height="${H - hor}" fill="url(#water)"/>
  <rect x="${sunX - 90}" y="${hor}" width="180" height="${H - hor}" fill="${P.glint}" opacity="0.14" filter="url(#soft)"/>
  ${glints}${foam}${vignette}`)
}

// —— 场景：极光 ——
function aurora(seed, P) {
  const rng = mulberry32(seed)
  const stars = Array.from({ length: 130 }, () => {
    const x = rng() * W
    const y = rng() * H * 0.62
    const r = rng() * 1.6 + 0.4
    return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#fff" opacity="${(0.25 + rng() * 0.6).toFixed(2)}"/>`
  }).join('')
  const bands = Array.from({ length: 5 }, (_, i) => {
    const y0 = H * (0.08 + i * 0.07) + rng() * 40
    const c = P.band[i % P.band.length]
    return `<path d="M -100 ${y0} C ${W * 0.25} ${y0 - 130 - rng() * 90}, ${W * 0.55} ${y0 + 120 + rng() * 80}, ${W + 100} ${y0 - 60 - rng() * 120}"
      stroke="${c}" stroke-width="${60 + rng() * 50}" fill="none" opacity="${(0.5 - i * 0.05).toFixed(2)}" filter="url(#soft30)"/>`
  }).join('')
  const defs = lin('sky', P.sky) + lin('snow', P.snow)
  return svgWrap(`<defs>${defs}${defsCommon}</defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars}${bands}
  ${ridge(rng, H * 0.88, 130, 6, P.far, 0.9)}
  <polygon points="0,${H} ${ridgePts(rng, H * 0.95, 90, 4)} ${W},${H}" fill="url(#snow)"/>
  ${vignette}`)
}

function ridgePts(rng, baseY, amp, peaks, x0 = 0, x1 = W) {
  const pts = []
  const step = (x1 - x0) / peaks
  for (let i = 0; i <= peaks; i++) {
    pts.push(`${(x0 + i * step).toFixed(0)},${(baseY - rng() * amp).toFixed(0)}`)
  }
  return pts.join(' ')
}

// —— 场景：冰川湖 ——
function glacier(seed, P) {
  const rng = mulberry32(seed)
  const hor = H * 0.6
  const defs = lin('sky', P.sky) + lin('water', P.water) + lin('ice', P.ice)
  const bergs = Array.from({ length: 9 }, () => {
    const x = rng() * W
    const s = 0.35 + rng() * 0.9
    const y = hor + 40 + rng() * (H - hor - 120)
    return `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${s.toFixed(2)})" opacity="${(0.8 + rng() * 0.2).toFixed(2)}">
      <ellipse cx="0" cy="16" rx="60" ry="10" fill="#0A2E3F" opacity="0.35"/>
      <polygon points="-52,10 -20,-34 8,-8 30,-26 56,10" fill="url(#ice)"/>
      <polygon points="-52,10 -20,-34 -12,10" fill="#FFFFFF" opacity="0.5"/>
    </g>`
  }).join('')
  return svgWrap(`<defs>${defs}${defsCommon}</defs>
  <rect width="${W}" height="${hor}" fill="url(#sky)"/>
  ${cloud(rng, W * 0.25, H * 0.16, 1.3, 0.6)}
  ${cloud(rng, W * 0.65, H * 0.24, 0.9, 0.5)}
  ${ridge(rng, hor + 4, 190, 6, P.far, 0.85)}
  <polygon points="0,${hor + 4} ${ridgePts(rng, hor - 40, 150, 5)} ${W},${hor + 4}" fill="url(#ice)" opacity="0.95"/>
  <rect y="${hor}" width="${W}" height="${H - hor}" fill="url(#water)"/>
  ${bergs}${vignette}`)
}

// —— 场景：寺社与红叶 ——
function temple(seed, P) {
  const rng = mulberry32(seed)
  const defs = lin('sky', P.sky) + lin('ground', P.ground)
  const hor = H * 0.78
  const gates = Array.from({ length: 4 }, (_, i) => {
    const s = 0.35 + i * 0.34 + rng() * 0.06
    const x = W * (0.16 + i * 0.06 + rng() * 0.05)
    const top = hor - 480 * s
    const w = 34 * s
    const h = 430 * s
    const beamY = top + 66 * s
    return `<g fill="${P.gate}" opacity="${(0.55 + i * 0.14).toFixed(2)}">
      <rect x="${(x - 190 * s).toFixed(0)}" y="${top.toFixed(0)}" width="${(380 * s + w).toFixed(0)}" height="${(26 * s).toFixed(0)}" rx="${(8 * s).toFixed(0)}"/>
      <rect x="${(x - 150 * s).toFixed(0)}" y="${beamY.toFixed(0)}" width="${(300 * s + w).toFixed(0)}" height="${(16 * s).toFixed(0)}"/>
      <rect x="${(x - 150 * s).toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"/>
      <rect x="${(x + 150 * s).toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}"/>
    </g>`
  }).join('')
  const leaves = Array.from({ length: 90 }, () => {
    const x = rng() * W
    const y = rng() * H * 0.72
    const s = 5 + rng() * 11
    const c = P.leaves[Math.floor(rng() * P.leaves.length)]
    const rot = rng() * 360
    return `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${s.toFixed(0)}" height="${(s * 0.62).toFixed(0)}" rx="${(s * 0.3).toFixed(0)}" fill="${c}" opacity="${(0.5 + rng() * 0.45).toFixed(2)}" transform="rotate(${rot.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" filter="url(#soft4)"/>`
  }).join('')
  const canopy = Array.from({ length: 16 }, () => {
    const x = rng() * W
    const y = rng() * H * 0.3
    const r = 60 + rng() * 130
    return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="${P.canopy}" opacity="0.5" filter="url(#soft30)"/>`
  }).join('')
  return svgWrap(`<defs>${defs}${defsCommon}
    <radialGradient id="sun2"><stop offset="0" stop-color="${P.glow}" stop-opacity="0.9"/><stop offset="1" stop-color="${P.glow}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${canopy}
  <circle cx="${W * 0.72}" cy="${H * 0.3}" r="240" fill="url(#sun2)"/>
  ${gates}
  <rect y="${hor}" width="${W}" height="${H - hor}" fill="url(#ground)"/>
  ${leaves}${vignette}`)
}

// —— 场景：湖泊 ——
function lake(seed, P) {
  const rng = mulberry32(seed)
  const hor = H * (0.5 + rng() * 0.05)
  const defs = lin('sky', P.sky) + lin('water', P.water) + lin('hill', P.hill)
  const ripples = Array.from({ length: 26 }, () => {
    const y = hor + 20 + rng() * (H - hor - 40)
    const w = 80 + rng() * 320
    const x = rng() * (W - w)
    return `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${w.toFixed(0)}" height="2.5" rx="1" fill="#fff" opacity="${(0.16 * (1 - (y - hor) / (H - hor)) + 0.04).toFixed(2)}"/>`
  }).join('')
  const boat = `<g transform="translate(${(W * 0.62).toFixed(0)} ${(hor + 150).toFixed(0)})" opacity="0.92">
    <path d="M -70 0 Q 0 26 70 0 L 52 10 Q 0 30 -52 10 Z" fill="${P.boat}"/>
    <rect x="-6" y="-38" width="4" height="40" fill="${P.boat}"/>
    <path d="M -2 -36 L 30 -6 L -2 -6 Z" fill="${P.sail}"/>
  </g>`
  return svgWrap(`<defs>${defs}${defsCommon}</defs>
  <rect width="${W}" height="${hor}" fill="url(#sky)"/>
  ${cloud(rng, W * 0.3, H * 0.16, 1.5, 0.65)}
  ${cloud(rng, W * 0.68, H * 0.1, 1.0, 0.5)}
  ${cloud(rng, W * 0.85, H * 0.24, 0.8, 0.45)}
  <polygon points="0,${hor} ${ridgePts(rng, hor - 170, 130, 4)} ${W * 0.62},${hor}" fill="url(#hill)" opacity="0.9"/>
  <polygon points="${W * 0.5},${hor} ${ridgePts(rng, hor - 110, 90, 3, W * 0.5, W * 1.05)} ${W},${hor}" fill="url(#hill)" opacity="0.7"/>
  <rect y="${hor}" width="${W}" height="${H - hor}" fill="url(#water)"/>
  <rect y="${hor}" width="${W}" height="90" fill="url(#hill)" opacity="0.18"/>
  ${ripples}${boat}${vignette}`)
}

// —— 场景：城市夜景 ——
function city(seed, P) {
  const rng = mulberry32(seed)
  const hor = H * 0.82
  const defs = lin('sky', P.sky) + lin('fade', [[0, P.glow, 0.5], [1, P.glow, 0]])
  const stars = Array.from({ length: 60 }, () => {
    const y = rng() * H * 0.4
    return `<circle cx="${(rng() * W).toFixed(0)}" cy="${y.toFixed(0)}" r="${(rng() * 1.2 + 0.3).toFixed(1)}" fill="#fff" opacity="${(0.2 + rng() * 0.4).toFixed(2)}"/>`
  }).join('')
  let bld = ''
  let x = -40
  while (x < W + 40) {
    const w = 90 + rng() * 150
    const h = 160 + rng() * 380
    const top = hor - h
    bld += `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${h.toFixed(0)}" fill="${P.bld}"/>`
    if (rng() > 0.75) bld += `<rect x="${(x + w * 0.4).toFixed(0)}" y="${(top - 40).toFixed(0)}" width="6" height="40" fill="${P.bld}"/>`
    const cols = Math.floor(w / 34)
    const rows = Math.floor(h / 46)
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rng() > 0.62) {
          const wx = x + 12 + c * 34
          const wy = top + 18 + r * 46
          const warm = rng() > 0.3
          bld += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="14" height="20" fill="${warm ? P.win : P.winCool}" opacity="${(0.5 + rng() * 0.5).toFixed(2)}"/>`
        }
      }
    }
    x += w + 8 + rng() * 18
  }
  const moonX = W * (0.2 + rng() * 0.5)
  return svgWrap(`<defs>${defs}${defsCommon}</defs>
  <rect width="${W}" height="${hor}" fill="url(#sky)"/>
  ${stars}
  <circle cx="${moonX.toFixed(0)}" cy="${(H * 0.18).toFixed(0)}" r="46" fill="${P.moon}" filter="url(#soft4)"/>
  <circle cx="${moonX.toFixed(0)}" cy="${(H * 0.18).toFixed(0)}" r="130" fill="url(#fade)"/>
  ${bld}
  <rect y="${hor}" width="${W}" height="${H - hor}" fill="${P.street}"/>
  <rect y="${hor - 8}" width="${W}" height="10" fill="${P.glow}" opacity="0.35" filter="url(#soft)"/>
  ${vignette}`)
}

// ————————————————— 旅行配置 —————————————————

const SCENES = { mountains, sea, aurora, glacier, temple, lake, city }

const kyoto = {
  scene: (seed, i) =>
    i % 4 === 0
      ? temple(seed, {
          sky: [[0, '#FFF3E4'], [1, '#FFD9B8']],
          glow: '#FFB877',
          gate: '#A63A2B',
          leaves: ['#D9542B', '#E8752F', '#C13A22', '#F29B4B'],
          canopy: '#E06A3A',
          ground: [[0, '#E9C9A4'], [1, '#D9B285']],
        })
      : i % 4 === 2
        ? lake(seed, {
            sky: [[0, '#FFE9D2'], [1, '#FDC99B']],
            water: [[0, '#E8A877'], [1, '#B97C56']],
            hill: [[0, '#9C5B3E'], [1, '#7A4128']],
            boat: '#5C3220',
            sail: '#F5EBDD',
          })
        : mountains(seed, {
            sky: [[0, '#FFEFD9'], [1, '#F7B98A']],
            glow: '#FFDFAE',
            sun: '#F59B57',
            far: '#B0714A',
            mid: '#8A5232',
            near: '#5E3520',
            haze: '#FFE4C4',
          }),
}

const iceland = {
  scene: (seed, i) => {
    const m = i % 4
    if (m === 0 || m === 1)
      return aurora(seed, {
        sky: [[0, '#04101F'], [1, '#0B2438']],
        band: ['#4BE3A0', '#2BC9B4', '#7DE8C8', '#5B6FE8', '#3ED9A2'],
        far: '#0E2E40',
        snow: [[0, '#DCEBF2'], [1, '#9FBFD0']],
      })
    if (m === 2)
      return glacier(seed, {
        sky: [[0, '#D9EDF6'], [1, '#A9CFE2']],
        water: [[0, '#7FB4CC'], [1, '#4E87A6']],
        ice: [[0, '#F2FBFF'], [1, '#BFE0EE']],
        far: '#7BA6BC',
      })
    return sea(seed, {
      sky: [[0, '#2C3E50'], [1, '#8FA6B4']],
      water: [[0, '#1C2830'], [1, '#0E1518']],
      glint: '#C9D6DD',
      foam: '#E8EEF2',
      far: '#3E5563',
    })
  },
}

const dali = {
  scene: (seed, i) =>
    i % 3 === 2
      ? mountains(seed, {
          sky: [[0, '#E3F4FD'], [1, '#BFE3F2']],
          glow: '#FFFFFF',
          sun: '#FFF6E0',
          far: '#7FA8BC',
          mid: '#5D87A0',
          near: '#3E657F',
          haze: '#EAF6FC',
        })
      : lake(seed, {
          sky: [[0, '#D8F0FC'], [1, '#A8DCF2']],
          water: [[0, '#6FB4D4'], [1, '#3E82AC']],
          hill: [[0, '#4E8CA0'], [1, '#37697E']],
          boat: '#2E4E5E',
          sail: '#FFFFFF',
        }),
}

const cityTrip = {
  scene: (seed, i) =>
    i % 3 === 1
      ? city(seed, {
          sky: [[0, '#1A1030'], [1, '#45275A']],
          bld: '#150C22',
          win: '#FFC96B',
          winCool: '#7FD4FF',
          moon: '#F5EED8',
          glow: '#B26BFF',
          street: '#0E0918',
        })
      : city(seed, {
          sky: [[0, '#0A1830'], [1, '#1D3A5C']],
          bld: '#0A1420',
          win: '#FFD98A',
          winCool: '#8AD2FF',
          moon: '#F0EBDC',
          glow: '#4B9FFF',
          street: '#070D14',
        }),
}

const TRIPS = [
  {
    dir: 'kyoto-autumn-2025',
    settings: {
      title: '京都 · 岚山秋色',
      description: '三天两夜，赶在红叶落尽前，把常寂光寺的石阶走了一遍又一遍。',
      startDate: '2025-11-02',
      endDate: '2025-11-05',
      tags: ['日本', '红叶', '独旅'],
      isFavorite: true,
    },
    gen: kyoto.scene,
    count: 8,
    captions: ['常寂光寺的山门', '黄昏时分的鸟居', '岚山远眺', '渡月桥的傍晚', '红叶落满石阶', '寺前的小路', '天光将暗', '最后一抹秋色'],
    gps: [35.0094, 135.6722], // 京都岚山一带
  },
  {
    dir: 'iceland-ring-2026',
    settings: {
      title: '冰岛环线 · 极光与黑沙',
      description: '一号公路开了一千三百公里，在零下十一度的夜里等到了极光。',
      startDate: '2026-02-14',
      endDate: '2026-02-21',
      tags: ['冰岛', '极光', '自驾'],
      isFavorite: true,
    },
    gen: iceland.scene,
    count: 8,
    captions: ['杰古沙龙冰河湖', '极光爆发的那一刻', '黑沙滩的浪', '冰块搁浅在岸上', '帐篷外的绿光', '午夜1点的天空', '冰川徒步前', '环线无人区'],
    gps: [64.0464, -16.1776], // 冰岛东南一线
  },
  {
    dir: 'dali-erhai-2026',
    settings: {
      title: '大理 · 洱海边的风',
      description: '租了辆自行车环洱海，风比想象中大，云比想象中低。',
      startDate: '2026-05-01',
      endDate: '2026-05-04',
      tags: ['云南', '骑行', '慢生活'],
      isFavorite: false,
    },
    gen: dali.scene,
    count: 6,
    captions: ['洱西的水面', '才村码头', '环海西路', '云压得很低', '苍山如黛', '小船摇了一天'],
    gps: [25.6533, 100.2289], // 洱海西岸
  },
  {
    dir: 'city-nights-2026',
    settings: {
      title: '城市夜行手册',
      description: '背着一台相机扫街到凌晨，霓虹落在湿漉漉的马路上一模一样。',
      startDate: '2026-07-11',
      endDate: '2026-07-12',
      tags: ['夜拍', '扫街'],
      isFavorite: false,
    },
    gen: cityTrip.scene,
    count: 6,
    captions: ['天桥上看车流', '便利店的灯', '雨后的十字路口', '凌晨的写字楼', '巷子深处', '末班地铁口'],
    gps: null, // 夜拍照片无定位：地图视图空态验收用
  },
]

// —— 大相册模式（GALLERY_DEMO_LARGE=N）：随机拼贴已有场景的旅行 ——
const LARGE_COUNT = Number.parseInt(process.env.GALLERY_DEMO_LARGE || '', 10) || 0

// ————————————————— 执行 —————————————————

mkdirSync(ALBUM, { recursive: true })
mkdirSync(USERDATA, { recursive: true })

/** 依旅行开始日期派生确定性的 EXIF 拍摄时间（EXIF 格式 'YYYY:MM:DD HH:mm:ss'） */
function exifTakenAt(startDate, i) {
  if (!startDate) return null
  const d = new Date(`${startDate}T00:00:00`)
  if (isNaN(d.getTime())) return null
  d.setDate(d.getDate() + Math.floor(i / 2))
  d.setHours(8 + ((i * 3) % 12), (i * 17) % 60, 0, 0)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 十进制度 → EXIF 度分秒有理数（秒精确到 0.01） */
function gpsExifDict(lat, lon) {
  const toDms = (v) => {
    const a = Math.abs(v)
    let d = Math.floor(a)
    const mF = (a - d) * 60
    let m = Math.floor(mF)
    let s = Math.round((mF - m) * 60 * 100)
    if (s >= 6000) {
      s = 0
      m += 1
      if (m >= 60) {
        m = 0
        d += 1
      }
    }
    return [
      [d, 1],
      [m, 1],
      [s, 100],
    ]
  }
  const gps = {}
  gps[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? 'N' : 'S'
  gps[piexif.GPSIFD.GPSLatitude] = toDms(lat)
  gps[piexif.GPSIFD.GPSLongitudeRef] = lon >= 0 ? 'E' : 'W'
  gps[piexif.GPSIFD.GPSLongitude] = toDms(lon)
  return gps
}

/**
 * 给 JPEG buffer 注入 EXIF（拍摄时间 + GPS）。
 * sharp 的 withExif 写不了 GPS IFD（libvips 丢弃 IFD1），故统一走 piexifjs（纯 JS）。
 */
function withExifBytes(jpegBuf, takenAtStr, lat, lon) {
  const exif = {}
  if (takenAtStr) exif[piexif.ExifIFD.DateTimeOriginal] = takenAtStr
  const dump = piexif.dump({
    Exif: exif,
    GPS: lat != null && lon != null ? gpsExifDict(lat, lon) : {},
  })
  const dataUrl = 'data:image/jpeg;base64,' + jpegBuf.toString('base64')
  return Buffer.from(piexif.insert(dump, dataUrl).split(',')[1], 'base64')
}

// 1. Windows 打包图标：icon.svg → icon.png（1024）
await sharp(join('build', 'icon.svg'), { density: 96 })
  .resize(1024, 1024)
  .png()
  .toFile(join('build', 'icon.png'))
console.log('icon.png ✓')

// 2. 生成照片与元数据
const rngee = mulberry32(20260830)
for (const trip of TRIPS) {
  const dir = join(ALBUM, trip.dir)
  mkdirSync(dir, { recursive: true })
  const photoCaptions = {}
  for (let i = 0; i < trip.count; i++) {
    const seed = Math.floor(rngee() * 1e9)
    const name = `DSC0${(50001 + i * 7 + Math.floor(rngee() * 5)).toString()}.jpg`
    const svg = trip.gen(seed, i)
    const dto = exifTakenAt(trip.settings.startDate, i)
    // GPS：旅行中心点附近确定性抖动（±0.03° 约两三公里），无 gps 配置则不写
    const jLat = trip.gps ? trip.gps[0] + (rngee() - 0.5) * 0.06 : null
    const jLon = trip.gps ? trip.gps[1] + (rngee() - 0.5) * 0.08 : null
    const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    writeFileSync(join(dir, name), withExifBytes(jpeg, dto, jLat, jLon))
    photoCaptions[name] = trip.captions[i] ?? ''
  }
  writeFileSync(join(dir, '.settings.json'), JSON.stringify({ ...trip.settings, photoCaptions }, null, 2))
  console.log(`${trip.dir} ✓ (${trip.count} 张${trip.gps ? ' +GPS' : ''})`)
}

// 2.5 大相册旅行（性能验收用）：场景循环复用，尺寸减半提速生成
if (LARGE_COUNT > 0) {
  const allScenes = [kyoto.scene, iceland.scene, dali.scene, cityTrip.scene]
  const dir = join(ALBUM, 'grand-album-large')
  mkdirSync(dir, { recursive: true })
  const photoCaptions = {}
  const bigW = W / 2
  const bigH = H / 2
  for (let i = 0; i < LARGE_COUNT; i++) {
    const seed = Math.floor(rngee() * 1e9)
    const name = `L${String(10000 + i * 3)}.jpg`
    const gen = allScenes[i % allScenes.length]
    const svg = gen(seed, i).replace(/width="1600"/, `width="${bigW}"`).replace(/height="1067"/, `height="${bigH}"`)
      .replace(/viewBox="0 0 1600 1067"/, `viewBox="0 0 ${bigW} ${bigH}"`)
    const dto = exifTakenAt('2026-03-10', i)
    const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 78, mozjpeg: true }).toBuffer()
    writeFileSync(join(dir, name), withExifBytes(jpeg, dto, null, null))
    photoCaptions[name] = i % 12 === 0 ? `大相册第 ${i + 1} 张` : ''
  }
  writeFileSync(
    join(dir, '.settings.json'),
    JSON.stringify(
      {
        title: '大相册压力测试',
        description: `${LARGE_COUNT} 张照片的滚动性能验收旅行。`,
        startDate: '2026-03-10',
        endDate: '2026-03-15',
        tags: ['性能'],
        isFavorite: false,
        photoCaptions,
      },
      null,
      2,
    ),
  )
  console.log(`grand-album-large ✓ (${LARGE_COUNT} 张)`)
}

// 2.6 HEIC 样张（HEIC 链路验收用）：macOS 用 sips 把 2 张现有 JPEG 转 .heic
// （sips 走系统编码器，EXIF/GPS 完整保留；sharp/libheif 写不了 HEVC）
if (process.platform === 'darwin' && existsSync('/usr/bin/sips')) {
  const dir = join(ALBUM, 'kyoto-autumn-2025')
  const jpgs = readFileSync(join(dir, '.settings.json'), 'utf8')
  const settings = JSON.parse(jpgs)
  const names = Object.keys(settings.photoCaptions).filter((n) => n.endsWith('.jpg')).slice(0, 2)
  for (const name of names) {
    const heicName = name.replace(/\.jpg$/i, '.heic')
    const res = spawnSync('/usr/bin/sips', ['-s', 'format', 'heic', join(dir, name), '--out', join(dir, heicName)], { stdio: 'ignore' })
    if (res.status === 0 && existsSync(join(dir, heicName))) {
      settings.photoCaptions[heicName] = `HEIC 样张（${name} 的副本）`
      console.log(`${heicName} ✓ (sips 转换)`)
    } else {
      console.log(`${heicName} ✗ sips 转换失败`)
    }
  }
  writeFileSync(join(dir, '.settings.json'), JSON.stringify(settings, null, 2))
}

// 3. 预置演示 userData：schema 与 src/main/db.ts migrate() 保持一致 + 浅色主题/窗口尺寸
const db = new Database(join(USERDATA, 'gallery.db'))
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok', created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY, album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    folder_name TEXT NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '',
    start_date TEXT, end_date TEXT, is_favorite INTEGER DEFAULT 0,
    cover_photo_id TEXT REFERENCES photos(id) ON DELETE SET NULL,
    created_at INTEGER, updated_at INTEGER, UNIQUE(album_id, folder_name)
  );
  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL, rel_path TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('image','video')), caption TEXT DEFAULT '',
    width INTEGER, height INTEGER, thumb_status TEXT DEFAULT 'pending', taken_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trip_tags (
    trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (trip_id, tag_id)
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`)
const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
put.run('theme_mode', 'light')
put.run('window_bounds', JSON.stringify({ width: 1600, height: 1000, x: 40, y: 40 }))
db.close()
console.log('userdata/gallery.db ✓')
