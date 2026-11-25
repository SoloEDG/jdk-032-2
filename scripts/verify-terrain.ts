/**
 * 地形与接触模型验证。
 * 运行：npm run verify
 *
 * 覆盖：
 *  1. 宽缓坡 —— 顺坡/逆坡传递、支承高程与地形吻合、顺坡更快
 *  2. 窄于一枚牌的凸脊 —— 标记不确定边界，模拟不悄悄穿过；宽脊/低脊对照
 *  3. 两片坡面相交处 —— 谷底支承、坡脚中断点、凸棱不确定
 *  4. 塑形后支脚自动贴合（不悬空、不沉入）
 *  5. 平地回归 —— 默认文档结果与改造前一致
 */
import assert from 'node:assert/strict'
import type { DominoDocument, Piece, SimulationEvent, TerrainField } from '../src/shared/document'
import { createDefaultDocument } from '../src/shared/defaults'
import {
  applyBrush,
  contactSpan,
  createFlatTerrain,
  crestMask,
  fallPathIntrusion,
  isTerrainValid,
  resampleTerrain,
  sampleHeight,
  stampLine,
  supportAt,
} from '../src/features/scene/lib/terrain'
import { propagate } from '../src/features/simulation/lib/propagate'

const SCENE = { gravity: 9.8, friction: 0.62, width: 21, height: 9, showGrid: false }

function makeDomino(id: string, x: number, y: number, angle = 0): Piece {
  return { id, kind: 'domino', x, y, angle, facing: 'east', label: id, height: 1.6, width: 0.42, fallThreshold: 0.8, friction: 0.55 }
}

function makeRamp(id: string, x: number, y: number, angle = 0): Piece {
  return { ...makeDomino(id, x, y, angle), kind: 'ramp', width: 1.7, height: 0.45 }
}

function makeDoc(pieces: Piece[], terrain: TerrainField, startPieceId: string): DominoDocument {
  return {
    id: 'verify', title: 'verify', revision: 1, updatedAt: 0,
    pieces, connections: [], scene: { ...SCENE }, terrain, startPieceId,
  }
}

function terrainFrom(fn: (x: number, y: number) => number): TerrainField {
  const terrain = createFlatTerrain(SCENE.width, SCENE.height)
  for (let j = 0; j < terrain.rows; j++) {
    for (let i = 0; i < terrain.cols; i++) {
      terrain.heights[j * terrain.cols + i] = fn(i * terrain.cell, j * terrain.cell)
    }
  }
  return terrain
}

function fallsOf(events: SimulationEvent[]) {
  return events.filter(event => event.kind === 'fall').map(event => event.pieceId)
}

function maskAt(terrain: TerrainField, x: number, y: number) {
  const mask = crestMask(terrain)
  const i = Math.round(x / terrain.cell)
  const j = Math.round(y / terrain.cell)
  return mask[j * terrain.cols + i]
}

let passed = 0
let failed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ok · ${name}`)
  } catch (error) {
    failed++
    console.error(`  FAIL · ${name}`)
    console.error(`       ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ---------- 1. 宽缓坡 ----------
console.log('\n[1] 宽缓坡')
const gentle = terrainFrom(x => 0.08 * (10 - x))
const downhillPieces = [2, 4, 6, 8].map((x, k) => makeDomino(`p${k + 1}`, x, 4.5, 0))
const downhill = propagate(makeDoc(downhillPieces, gentle, 'p1'))
const downhillFlat = propagate(makeDoc(downhillPieces, createFlatTerrain(21, 9), 'p1'))

check('顺坡依次倒下到底', () => {
  assert.deepEqual(fallsOf(downhill.events), ['p1', 'p2', 'p3', 'p4'])
})
check('每件支承高程与坡面吻合（不沉入、不悬空）', () => {
  for (const event of downhill.events.filter(e => e.kind === 'fall')) {
    const piece = downhillPieces.find(p => p.id === event.pieceId)!
    const ground = 0.08 * (10 - piece.x)
    assert.ok(event.supportZ !== undefined, '缺少支承高程')
    assert.ok(event.supportZ! >= ground - 1e-9, `支承 ${event.supportZ} 沉入地面 ${ground}`)
    assert.ok(event.supportZ! <= 0.08 * (10 - piece.x + 0.21) + 0.0015, `支承 ${event.supportZ} 悬空于足迹最高点`)
    assert.ok(Math.abs(event.supportZ! - 0.08 * (10 - piece.x + 0.21)) < 0.0015, '支承应贴合足迹内最高地形点')
  }
})
check('宽缓坡不产生不确定边界', () => {
  const mask = crestMask(gentle)
  assert.equal(mask.reduce((a, b) => a + b, 0), 0)
  assert.ok(downhill.events.every(event => !event.uncertain))
})
check('顺坡倒下比平地更快', () => {
  assert.ok(downhill.duration < downhillFlat.duration, `${downhill.duration} 应小于 ${downhillFlat.duration}`)
})
check('缓坡逆坡传递不被误挡', () => {
  const up = propagate(makeDoc([2, 3.6, 5.2, 6.8, 8.4].map((x, k) => makeDomino(`u${k + 1}`, x, 4.5, 0)), terrainFrom(x => 0.08 * x), 'u1'))
  assert.deepEqual(fallsOf(up.events), ['u1', 'u2', 'u3', 'u4', 'u5'])
})
check('宽陡坡逆坡：中断点停在坡下，原因指向高差', () => {
  const steep = terrainFrom(x => 0.5 * x)
  const pieces = [2, 4.1, 6.2].map((x, k) => makeDomino(`s${k + 1}`, x, 4.5, 0))
  const result = propagate(makeDoc(pieces, steep, 's1'))
  assert.deepEqual(fallsOf(result.events), ['s1'])
  assert.equal(result.interruptedPieceId, 's1')
  assert.match(result.interruptionReason ?? '', /高出/)
  const flat = propagate(makeDoc(pieces, createFlatTerrain(21, 9), 's1'))
  assert.deepEqual(fallsOf(flat.events), ['s1', 's2', 's3'], '同样布局在平地上应畅通')
})

// ---------- 2. 窄于一枚牌的凸脊 ----------
console.log('\n[2] 窄脊（窄于一枚牌）')
const narrowRidge = terrainFrom(x => 0.35 * Math.exp(-(((x - 10.2) / 0.14) ** 2)))
const wideRidge = terrainFrom(x => Math.abs(x - 10.2) < 0.6 ? 0.35 * Math.cos(Math.PI * (x - 10.2) / 1.2) : 0)
const lowWideRidge = terrainFrom(x => Math.abs(x - 10.2) < 0.6 ? 0.1 * Math.cos(Math.PI * (x - 10.2) / 1.2) : 0)

check('窄脊被标记为不确定边界，周围平地不误标', () => {
  assert.equal(maskAt(narrowRidge, 10.2, 4.5), 1)
  assert.equal(maskAt(narrowRidge, 8.4, 4.5), 0)
  assert.equal(maskAt(narrowRidge, 12, 4.5), 0)
})
check('窄脊上的支承标记不确定，支承高程贴合脊顶', () => {
  const onCrest = supportAt(narrowRidge, 10.2, 4.5, 0.21)
  assert.equal(onCrest.uncertain, true)
  assert.ok(Math.abs(onCrest.z - 0.35) < 0.01)
  assert.equal(supportAt(narrowRidge, 8.4, 4.5, 0.21).uncertain, false)
})
check('窄脊挡住的链路不被模拟穿过，且标出不确定', () => {
  const pieces = [makeDomino('a1', 9.3, 4.5, 0), makeDomino('a2', 11.1, 4.5, 0)]
  const result = propagate(makeDoc(pieces, narrowRidge, 'a1'))
  assert.deepEqual(fallsOf(result.events), ['a1'], '脊后的牌不应倒下')
  assert.equal(result.interruptedPieceId, 'a1')
  assert.match(result.interruptionReason ?? '', /不确定边界/)
  const interrupted = result.events.find(e => e.kind === 'interrupted')!
  assert.equal(interrupted.uncertain, true)
  const flat = propagate(makeDoc(pieces, createFlatTerrain(21, 9), 'a1'))
  assert.deepEqual(fallsOf(flat.events), ['a1', 'a2'], '无脊时同样间距应传递')
})
check('宽脊是可靠地形：同样阻断但不标不确定', () => {
  assert.equal(maskAt(wideRidge, 10.2, 4.5), 0, '宽于一枚牌的脊不应标为不确定边界')
  const pieces = [makeDomino('b1', 9.3, 4.5, 0), makeDomino('b2', 11.1, 4.5, 0)]
  const result = propagate(makeDoc(pieces, wideRidge, 'b1'))
  assert.deepEqual(fallsOf(result.events), ['b1'])
  assert.match(result.interruptionReason ?? '', /地形/)
  assert.ok(result.events.every(e => !e.uncertain))
})
check('低矮宽坡不妨碍传递', () => {
  const pieces = [makeDomino('c1', 9.3, 4.5, 0), makeDomino('c2', 11.1, 4.5, 0)]
  const result = propagate(makeDoc(pieces, lowWideRidge, 'c1'))
  assert.deepEqual(fallsOf(result.events), ['c1', 'c2'])
})

// ---------- 3. 两片坡面相交处 ----------
console.log('\n[3] 两片坡面相交')
const valley = terrainFrom(x => 0.5 * Math.abs(x - 10.2))
const roof = terrainFrom(x => Math.max(0, 0.6 - 0.5 * Math.abs(x - 10.2)))

check('谷底支承可靠且与可见地形吻合', () => {
  const support = supportAt(valley, 10.2, 4.5, 0.21)
  assert.equal(support.uncertain, false, '凹谷不是不确定边界')
  assert.ok(Math.abs(support.z - 0.105) < 0.01, `桥接支承应为 0.105，实得 ${support.z}`)
  assert.ok(support.z >= sampleHeight(valley, 10.2, 4.5) - 1e-9, '不得沉入谷底以下')
  assert.equal(maskAt(valley, 10.2, 4.5), 0)
})
check('谷中链路：顺坡入谷成立，逆坡出谷在坡脚中断', () => {
  const pieces = [makeDomino('v1', 8.7, 4.5, 0), makeDomino('v2', 10.2, 4.5, 0), makeDomino('v3', 11.7, 4.5, 0)]
  const result = propagate(makeDoc(pieces, valley, 'v1'))
  assert.deepEqual(fallsOf(result.events), ['v1', 'v2'])
  assert.equal(result.interruptedPieceId, 'v2', '中断点应在谷底那件')
  assert.match(result.interruptionReason ?? '', /地形/)
  const v2 = result.events.find(e => e.pieceId === 'v2' && e.kind === 'fall')!
  assert.ok(Math.abs(v2.supportZ! - 0.105) < 0.01, '回放支承高程应与谷底地形一致')
})
check('屋脊式凸棱标为不确定边界', () => {
  assert.equal(maskAt(roof, 10.2, 4.5), 1)
  assert.equal(supportAt(roof, 10.2, 4.5, 0.21).uncertain, true)
})

// ---------- 4. 坡道接新地面 ----------
console.log('\n[4] 坡道接新地面')
check('地面抬升迎接坡道时递送仍然成立', () => {
  const ground = terrainFrom(x => 0.4 * Math.max(0, Math.min(1, (x - 10.5) / 1)))
  const pieces = [makeRamp('r1', 10.2, 4.2, 0), makeDomino('n1', 12.1, 3.55, -20)]
  const result = propagate(makeDoc(pieces, ground, 'r1'))
  assert.deepEqual(fallsOf(result.events), ['r1', 'n1'], '坡道出口随地形贴合，递送应到达新地面上的骨牌')
})
check('坡道出口前方陡坎会挡住滑件', () => {
  const ground = terrainFrom(x => 0.9 * Math.max(0, Math.min(1, (x - 10.5) / 1)))
  const pieces = [makeRamp('r1', 10.2, 4.2, 0), makeDomino('n1', 12.1, 3.55, -20)]
  const result = propagate(makeDoc(pieces, ground, 'r1'))
  assert.deepEqual(fallsOf(result.events), ['r1'])
  assert.match(result.interruptionReason ?? '', /地形/)
})

// ---------- 5. 塑形后支脚自动贴合 ----------
console.log('\n[5] 塑形后支脚贴合')
check('抬高后支承随之上升，压低后随之下降，从不沉入地面', () => {
  const flat = createFlatTerrain(21, 9)
  const raised = applyBrush(flat, 5, 4.5, 0.9, 0.3)
  const up = supportAt(raised, 5, 4.5, 0.21)
  assert.ok(up.z > 0.2, `抬高后支承应上升，实得 ${up.z}`)
  assert.ok(up.z >= sampleHeight(raised, 5, 4.5) - 1e-9, '支承不得沉入地面')
  const lowered = applyBrush(flat, 5, 4.5, 0.9, -0.3)
  const down = supportAt(lowered, 5, 4.5, 0.21)
  assert.ok(down.z < -0.2, `压低后支承应下降，实得 ${down.z}`)
  assert.ok(down.z >= sampleHeight(lowered, 5, 4.5) - 1e-9, '凹槽内支承不得沉入地面')
})
check('笔刷拖出的窄脊线即时标为不确定边界', () => {
  const flat = createFlatTerrain(21, 9)
  const ridge = stampLine(flat, { x: 4, y: 4.5 }, { x: 6, y: 4.5 }, 0.3, 0.35)
  assert.equal(maskAt(ridge, 5.1, 4.5), 1)
  assert.equal(supportAt(ridge, 5.1, 4.5, 0.21).uncertain, true)
})

// ---------- 6. 平地回归 ----------
console.log('\n[6] 平地回归')
check('默认文档在平面地形上的传播结果与改造前一致', () => {
  const result = propagate(createDefaultDocument())
  const order = result.events.filter(e => e.kind !== 'interrupted').map(e => e.pieceId)
  assert.deepEqual(order, ['d1', 'd2', 'd3', 'd4', 'd5', 'r1', 'd6', 's1', 'd7', 'd9', 'd10', 'd8', 't1'])
  assert.equal(result.interruptedPieceId, 'd10')
  assert.equal(result.status, 'interrupted')
  assert.ok(result.events.every(e => e.supportZ === 0), '平地上支承高程应全为 0')
  assert.ok(result.events.every(e => !e.uncertain), '平地上不应出现不确定标记')
})
check('接触跨距与扫掠检查的基础性质', () => {
  assert.ok(Math.abs(contactSpan(0, 0.5, 1.6, 1.5) - Math.hypot(1.5, 0.5)) < 1e-9, '上坡缩短倒程')
  assert.equal(contactSpan(0, -0.5, 1.6, 1.5), 1.5, '下坡不额外加分')
  assert.ok(Math.abs(contactSpan(0, -2, 1.6, 1.5) - Math.hypot(1.5, 0.4)) < 1e-9, '深坑目标消耗倒程')
  const flat = createFlatTerrain(21, 9)
  assert.equal(fallPathIntrusion(flat, { x: 2, y: 4.5 }, { x: 4, y: 4.5 }, 0, 1.6, 0.21, 0.21), null)
})
check('地形迁移与重采样', () => {
  const flat = createFlatTerrain(21, 9)
  assert.equal(isTerrainValid(flat, 21, 9), true)
  assert.equal(isTerrainValid(undefined, 21, 9), false)
  const resampled = resampleTerrain(terrainFrom(x => 0.08 * x), 12, 9)
  assert.equal(resampled.cols, 41)
  assert.ok(Math.abs(sampleHeight(resampled, 6, 4.5) - 0.48) < 0.01)
})

console.log(`\n${passed} 项通过，${failed} 项失败`)
process.exit(failed ? 1 : 0)
