import type { TerrainField, Vec2 } from '@/shared/document'

/** 地形网格间距（米）。 */
export const TERRAIN_CELL = 0.3
/** 允许抬升 / 压低的最大幅度（米）。 */
export const TERRAIN_MAX_RELIEF = 1.5
/**
 * 窄脊判定的采样距离（米），约半枚骨牌宽。
 * 沿某一轴向两侧各取一点，若地面都跌落超过 CREST_DROP，
 * 说明该处是窄于一枚牌支承面的凸脊，无法可靠参与接触。
 */
export const CREST_SAMPLE_DIST = 0.21
/** 两侧同时跌落超过该值（米）则标记为不确定边界。 */
export const CREST_DROP = 0.1
/** 倒程扫掠体忽略小于该值的地面起伏（米），避免细碎纹理阻断链路。 */
export const INTRUSION_MIN_RELIEF = 0.12

export function terrainNodeCount(width: number, height: number, cell = TERRAIN_CELL) {
  return {
    cols: Math.max(2, Math.round(width / cell) + 1),
    rows: Math.max(2, Math.round(height / cell) + 1),
  }
}

export function createFlatTerrain(width: number, height: number, cell = TERRAIN_CELL): TerrainField {
  const { cols, rows } = terrainNodeCount(width, height, cell)
  return { cell, cols, rows, heights: new Array<number>(cols * rows).fill(0) }
}

export function isTerrainValid(terrain: TerrainField | undefined, width: number, height: number): terrain is TerrainField {
  if (!terrain || typeof terrain.cell !== 'number' || !(terrain.cell > 0)) return false
  if (!Array.isArray(terrain.heights)) return false
  const { cols, rows } = terrainNodeCount(width, height, terrain.cell)
  return terrain.cols === cols && terrain.rows === rows && terrain.heights.length === cols * rows
}

/** 双线性插值采样任意世界坐标的高程，越界时钳到边界节点。 */
export function sampleHeight(terrain: TerrainField, x: number, y: number): number {
  const gx = Math.min(Math.max(x / terrain.cell, 0), terrain.cols - 1 - 1e-9)
  const gy = Math.min(Math.max(y / terrain.cell, 0), terrain.rows - 1 - 1e-9)
  const i = Math.floor(gx)
  const j = Math.floor(gy)
  const fx = gx - i
  const fy = gy - j
  const { heights, cols } = terrain
  const a = heights[j * cols + i]
  const b = heights[j * cols + i + 1]
  const c = heights[(j + 1) * cols + i]
  const d = heights[(j + 1) * cols + i + 1]
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** 场景尺寸变化时保留原有起伏，重采样到新的网格范围。 */
export function resampleTerrain(terrain: TerrainField, width: number, height: number): TerrainField {
  const cell = terrain.cell > 0 ? terrain.cell : TERRAIN_CELL
  const { cols, rows } = terrainNodeCount(width, height, cell)
  const maxX = (terrain.cols - 1) * terrain.cell
  const maxY = (terrain.rows - 1) * terrain.cell
  const heights = new Array<number>(cols * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const h = sampleHeight(terrain, Math.min(i * cell, maxX), Math.min(j * cell, maxY))
      heights[j * cols + i] = Math.round(h * 1000) / 1000
    }
  }
  return { cell, cols, rows, heights }
}

function clampHeight(h: number) {
  return Math.round(Math.max(-TERRAIN_MAX_RELIEF, Math.min(TERRAIN_MAX_RELIEF, h)) * 1000) / 1000
}

/** 余弦衰减笔刷：在 (x, y) 处抬升（delta > 0）或压低（delta < 0），返回新高度场。 */
export function applyBrush(terrain: TerrainField, x: number, y: number, radius: number, delta: number): TerrainField {
  const r = Math.max(terrain.cell * 0.5, radius)
  const heights = terrain.heights.slice()
  const i0 = Math.max(0, Math.floor((x - r) / terrain.cell))
  const i1 = Math.min(terrain.cols - 1, Math.ceil((x + r) / terrain.cell))
  const j0 = Math.max(0, Math.floor((y - r) / terrain.cell))
  const j1 = Math.min(terrain.rows - 1, Math.ceil((y + r) / terrain.cell))
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * terrain.cell - x, j * terrain.cell - y)
      if (d > r) continue
      const w = 0.5 * (1 + Math.cos(Math.PI * d / r))
      const idx = j * terrain.cols + i
      heights[idx] = clampHeight(heights[idx] + delta * w)
    }
  }
  return { ...terrain, heights }
}

/** 沿拖动路径连续落笔，相邻落笔间距半格，慢拖会自然堆得更高。 */
export function stampLine(terrain: TerrainField, from: Vec2, to: Vec2, radius: number, delta: number): TerrainField {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.max(1, Math.ceil(length / (terrain.cell * 0.5)))
  let next = terrain
  for (let k = 1; k <= steps; k++) {
    const t = k / steps
    next = applyBrush(next, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius, delta)
  }
  return next
}

const CREST_AXES: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
]

const crestCache = new WeakMap<TerrainField, Uint8Array>()

/**
 * 标记“窄于一枚牌”的凸脊节点：沿任一轴向，两侧 CREST_SAMPLE_DIST
 * 处的地面都比该节点低 CREST_DROP 以上。宽缓坡、坡面交线（凹谷）、
 * 凹槽边缘和平台边缘都不会被标记；窄凸脊和尖锐的屋脊式棱线会被标记。
 * 已知限制：贴场景边缘的窄脊因采样钳到边界可能漏标。
 */
export function crestMask(terrain: TerrainField): Uint8Array {
  const cached = crestCache.get(terrain)
  if (cached) return cached
  const { cols, rows, cell, heights } = terrain
  const mask = new Uint8Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const h = heights[j * cols + i]
      const x = i * cell
      const y = j * cell
      for (const [ax, ay] of CREST_AXES) {
        const plus = sampleHeight(terrain, x + ax * CREST_SAMPLE_DIST, y + ay * CREST_SAMPLE_DIST)
        const minus = sampleHeight(terrain, x - ax * CREST_SAMPLE_DIST, y - ay * CREST_SAMPLE_DIST)
        if (h - plus > CREST_DROP && h - minus > CREST_DROP) {
          mask[j * cols + i] = 1
          break
        }
      }
    }
  }
  crestCache.set(terrain, mask)
  return mask
}

export interface SupportInfo {
  /** 支承高程：足迹圆盘内的地形最高点，保证不穿透地面也不悬空。 */
  z: number
  /** 足迹内的地形最低点。 */
  min: number
  /** 足迹内最大高差，越大说明脚下越不平。 */
  spread: number
  /** 足迹压到窄脊（不确定边界），支承不可靠。 */
  uncertain: boolean
}

/** 派生元件在 (x, y) 处的支承信息。半径取元件宽度的一半（足迹圆盘）。 */
export function supportAt(terrain: TerrainField, x: number, y: number, radius: number, crests?: Uint8Array): SupportInfo {
  const r = Math.max(0.05, radius)
  let max = -Infinity
  let min = Infinity
  for (let k = 0; k < 17; k++) {
    const ring = k === 0 ? 0 : k < 7 ? r * 0.55 : r
    const angle = k === 0 ? 0 : (k < 7 ? (k - 1) : k - 7) * (Math.PI / (k < 7 ? 3 : 5))
    const h = sampleHeight(terrain, x + Math.cos(angle) * ring, y + Math.sin(angle) * ring)
    if (h > max) max = h
    if (h < min) min = h
  }
  const mask = crests ?? crestMask(terrain)
  let uncertain = false
  const i0 = Math.max(0, Math.floor((x - r) / terrain.cell))
  const i1 = Math.min(terrain.cols - 1, Math.ceil((x + r) / terrain.cell))
  const j0 = Math.max(0, Math.floor((y - r) / terrain.cell))
  const j1 = Math.min(terrain.rows - 1, Math.ceil((y + r) / terrain.cell))
  for (let j = j0; j <= j1 && !uncertain; j++) {
    for (let i = i0; i <= i1; i++) {
      if (mask[j * terrain.cols + i] !== 1) continue
      if (Math.hypot(i * terrain.cell - x, j * terrain.cell - y) <= r + terrain.cell * 0.5) {
        uncertain = true
        break
      }
    }
  }
  return { z: max, min, spread: max - min, uncertain }
}

/**
 * 倒下触达目标的合成跨距：水平距叠加上目标高差。
 * 目标支承高于源时倒程缩短；低于源时不加分（倒下的牌不会因此变长），
 * 但目标整体沉到源支承平面以下时，超出部分同样消耗倒程。
 */
export function contactSpan(sourceZ: number, targetZ: number, targetHeight: number, separation: number): number {
  const dz = targetZ - sourceZ
  const zNear = dz >= 0 ? dz : dz + targetHeight < 0 ? dz + targetHeight : 0
  return Math.hypot(separation, zNear)
}

export interface PathIntrusion {
  x: number
  y: number
  z: number
  /** 距源元件中心的水平距离。 */
  distance: number
  /** 侵入点位于窄脊（不确定边界）上，无法可靠判定。 */
  uncertain: boolean
}

/**
 * 倒程扫掠检查：从 from 到 to 的路径上，地形若隆起进入以源支脚前沿为
 * 圆心、sweepLength 为半径的倒下扫掠体，倒下的牌会被地形托住。
 * 返回离源最近的一处侵入；没有则返回 null。
 */
export function fallPathIntrusion(
  terrain: TerrainField,
  from: Vec2,
  to: Vec2,
  sourceZ: number,
  sweepLength: number,
  marginStart: number,
  marginEnd: number,
  crests?: Uint8Array,
): PathIntrusion | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return null
  const ux = dx / length
  const uy = dy / length
  const mask = crests ?? crestMask(terrain)
  const step = terrain.cell * 0.5
  const end = length - Math.max(0, marginEnd)
  for (let s = Math.max(step, marginStart); s < end; s += step) {
    const px = from.x + ux * s
    const py = from.y + uy * s
    const rel = sampleHeight(terrain, px, py) - sourceZ
    if (rel <= INTRUSION_MIN_RELIEF) continue
    if (Math.hypot(s - marginStart, rel) >= sweepLength * 0.99) continue
    const ci = Math.min(terrain.cols - 1, Math.max(0, Math.round(px / terrain.cell)))
    const cj = Math.min(terrain.rows - 1, Math.max(0, Math.round(py / terrain.cell)))
    return { x: px, y: py, z: sourceZ + rel, distance: s, uncertain: mask[cj * terrain.cols + ci] === 1 }
  }
  return null
}

/**
 * 滑动递送检查：坡道送出的滑件贴着地面滑行，可以爬过缓坡，
 * 但路径上相对出口抬升超过 maxStep 的台阶会挡住递送。
 * 返回离出口最近的一处台阶；没有则返回 null。
 */
export function slidePathStep(
  terrain: TerrainField,
  from: Vec2,
  to: Vec2,
  sourceZ: number,
  maxStep: number,
  marginEnd: number,
  crests?: Uint8Array,
): PathIntrusion | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return null
  const ux = dx / length
  const uy = dy / length
  const mask = crests ?? crestMask(terrain)
  const step = terrain.cell * 0.5
  const end = length - Math.max(0, marginEnd)
  for (let s = step; s < end; s += step) {
    const px = from.x + ux * s
    const py = from.y + uy * s
    const rel = sampleHeight(terrain, px, py) - sourceZ
    if (rel <= maxStep) continue
    const ci = Math.min(terrain.cols - 1, Math.max(0, Math.round(px / terrain.cell)))
    const cj = Math.min(terrain.rows - 1, Math.max(0, Math.round(py / terrain.cell)))
    return { x: px, y: py, z: sourceZ + rel, distance: s, uncertain: mask[cj * terrain.cols + ci] === 1 }
  }
  return null
}

/** 提取一条等高线的线段集（ marching squares ），返回扁平坐标 [x1,y1,x2,y2,…]。 */
export function contourSegments(terrain: TerrainField, level: number): number[] {
  const { cols, rows, cell, heights } = terrain
  const segments: number[] = []
  const push = (x1: number, y1: number, x2: number, y2: number) => {
    segments.push(x1, y1, x2, y2)
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = heights[j * cols + i]
      const b = heights[j * cols + i + 1]
      const c = heights[(j + 1) * cols + i + 1]
      const d = heights[(j + 1) * cols + i]
      let index = 0
      if (a > level) index |= 1
      if (b > level) index |= 2
      if (c > level) index |= 4
      if (d > level) index |= 8
      if (index === 0 || index === 15) continue
      const x0 = i * cell
      const y0 = j * cell
      const t = (p: number, q: number) => (level - p) / (q - p)
      const bottom: [number, number] = [x0 + t(a, b) * cell, y0]
      const right: [number, number] = [x0 + cell, y0 + t(b, c) * cell]
      const top: [number, number] = [x0 + t(d, c) * cell, y0 + cell]
      const left: [number, number] = [x0, y0 + t(a, d) * cell]
      switch (index) {
        case 1: case 14: push(...left, ...bottom); break
        case 2: case 13: push(...bottom, ...right); break
        case 3: case 12: push(...left, ...right); break
        case 4: case 11: push(...right, ...top); break
        case 5: push(...left, ...bottom); push(...right, ...top); break
        case 6: case 9: push(...bottom, ...top); break
        case 7: case 8: push(...left, ...top); break
        case 10: push(...bottom, ...right); push(...left, ...top); break
      }
    }
  }
  return segments
}

/** 地形起伏范围。 */
export function terrainRelief(terrain: TerrainField) {
  let min = Infinity
  let max = -Infinity
  for (const h of terrain.heights) {
    if (h < min) min = h
    if (h > max) max = h
  }
  return { min, max }
}
