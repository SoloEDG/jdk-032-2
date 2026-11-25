import type { DominoDocument, Piece, SimulationEvent, Vec2 } from '@/shared/document'
import { angleBetween, forwardVector } from '@/features/layout/lib/geometry'
import {
  contactSpan,
  createFlatTerrain,
  crestMask,
  fallPathIntrusion,
  sampleHeight,
  slidePathStep,
  supportAt,
  type SupportInfo,
} from '@/features/scene/lib/terrain'

interface Scheduled {
  pieceId: string
  time: number
  causeId: string | null
  detail: string
  uncertain?: boolean
}

interface ContactVerdict {
  target: Piece | null
  /** 倒程被可靠地形（宽坡、台地）阻断。 */
  blockedByTerrain: boolean
  /** 倒程压到窄脊（不确定边界），无法可靠判定接触。 */
  blockedUncertain: boolean
  /** 最近的对齐目标因位于高处而够不到。 */
  uphill: { piece: Piece; dz: number } | null
}

interface ContactSearch {
  origin: Vec2
  originZ: number
  reach: number
  cone: number
  sweep: number
  marginStart: number
  /** 坡道递送：滑件可爬过的最大台阶高度；设置后改用台阶检查而非扫掠检查。 */
  slideMaxStep?: number
}

export function propagate(document: DominoDocument) {
  const terrain = document.terrain ?? createFlatTerrain(document.scene.width, document.scene.height)
  const crests = crestMask(terrain)
  const supports = new Map<string, SupportInfo>()
  const supportOf = (piece: Piece) => {
    const cached = supports.get(piece.id)
    if (cached) return cached
    const info = supportAt(terrain, piece.x, piece.y, piece.width / 2, crests)
    supports.set(piece.id, info)
    return info
  }

  function searchContact(piece: Piece, available: Piece[], cfg: ContactSearch): ContactVerdict {
    const facing = forwardVector(piece)
    const aligned = available
      .map(item => {
        const delta = { x: item.x - cfg.origin.x, y: item.y - cfg.origin.y }
        return { item, distance: Math.hypot(delta.x, delta.y), alignment: angleBetween(facing, delta) }
      })
      .filter(entry => entry.alignment < cfg.cone && entry.distance <= cfg.reach * 1.6)
      .sort((a, b) => a.distance - b.distance || a.item.id.localeCompare(b.item.id))
    let blockedByTerrain = false
    let blockedUncertain = false
    let uphill: ContactVerdict['uphill'] = null
    for (const entry of aligned) {
      const zT = supportOf(entry.item).z
      const span = contactSpan(cfg.originZ, zT, entry.item.height, entry.distance)
      if (span >= cfg.reach) {
        if (!uphill && zT - cfg.originZ > 0.05) uphill = { piece: entry.item, dz: zT - cfg.originZ }
        continue
      }
      const intrusion = cfg.slideMaxStep !== undefined
        ? slidePathStep(terrain, cfg.origin, entry.item, cfg.originZ, cfg.slideMaxStep, entry.item.width / 2, crests)
        : fallPathIntrusion(
          terrain, cfg.origin, entry.item, cfg.originZ, cfg.sweep, cfg.marginStart, entry.item.width / 2, crests,
        )
      if (intrusion) {
        if (intrusion.uncertain) blockedUncertain = true
        else blockedByTerrain = true
        continue
      }
      return { target: entry.item, blockedByTerrain, blockedUncertain, uphill }
    }
    return { target: null, blockedByTerrain, blockedUncertain, uphill }
  }

  const queue: Scheduled[] = [{ pieceId: document.startPieceId, time: 0, causeId: null, detail: '手动触发' }]
  const fallen = new Set<string>()
  const events: SimulationEvent[] = []
  let interruptedPieceId: string | null = null
  let interruptionReason: string | null = null
  let reachedTrigger = false

  while (queue.length && events.length < document.pieces.length * 3) {
    queue.sort((a, b) => a.time - b.time || a.pieceId.localeCompare(b.pieceId) || (a.causeId ?? '').localeCompare(b.causeId ?? ''))
    const next = queue.shift()!
    const piece = document.pieces.find(item => item.id === next.pieceId)
    if (!piece || fallen.has(piece.id)) continue

    if (piece.kind === 'trigger') {
      const event: SimulationEvent = {
        id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time,
        causeId: next.causeId, kind: 'mechanism', detail: `触发器响应 · ${next.detail}`,
        supportZ: Math.round(supportOf(piece).z * 1000) / 1000,
      }
      events.push(event)
      reachedTrigger = true
      for (const link of document.connections.filter(link => link.from === piece.id && link.enabled)) {
        queue.push({ pieceId: link.to, time: next.time + link.delay, causeId: event.id, detail: '机关连线' })
      }
      continue
    }

    fallen.add(piece.id)
    const support = supportOf(piece)
    const uncertain = Boolean(next.uncertain) || support.uncertain
    const event: SimulationEvent = {
      id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time,
      causeId: next.causeId, kind: piece.kind === 'splitter' ? 'mechanism' : 'fall',
      detail: piece.kind === 'splitter' ? `分岔展开 · ${next.detail}`
        : piece.kind === 'ramp' ? `坡道传递 · ${next.detail}` : `受力倒下 · ${next.detail}`,
      supportZ: Math.round(support.z * 1000) / 1000,
    }
    if (uncertain) event.uncertain = true
    events.push(event)

    for (const link of document.connections.filter(link => link.from === piece.id && link.enabled)) {
      queue.push({ pieceId: link.to, time: next.time + link.delay, causeId: event.id, detail: '机关连线' })
    }

    const available = document.pieces.filter(item => !fallen.has(item.id) && item.id !== piece.id)
    const surfaceGrip = (document.scene.friction + piece.friction) / 2
    const reachScale = (0.94 + surfaceGrip * 0.35) * (1.25 - piece.fallThreshold * 0.25)
    let verdict: ContactVerdict
    if (piece.kind === 'ramp') {
      const facing = forwardVector(piece)
      const exit = { x: piece.x + facing.x * piece.width / 2, y: piece.y + facing.y * piece.width / 2 }
      verdict = searchContact(piece, available, {
        origin: exit,
        originZ: sampleHeight(terrain, exit.x, exit.y),
        reach: piece.width * 1.6,
        cone: 60,
        sweep: piece.width,
        marginStart: 0,
        slideMaxStep: piece.height * 0.7,
      })
    } else {
      verdict = searchContact(piece, available, {
        origin: { x: piece.x, y: piece.y },
        originZ: support.z,
        reach: piece.height * 1.18 * reachScale,
        cone: 47,
        sweep: piece.height,
        marginStart: piece.width / 2,
      })
    }
    const target = verdict.target
    if (target) {
      const separation = Math.hypot(piece.x - target.x, piece.y - target.y)
      const slope = (supportOf(target).z - support.z) / Math.max(0.3, separation)
      const slopeFactor = Math.max(0.6, Math.min(1.5, 1 - slope * 1.2))
      const speed = Math.max(1.8, piece.height * document.scene.gravity / 2) * (0.75 + surfaceGrip * 0.5) * slopeFactor
      const travel = Math.max(0.24, separation / speed)
      const contactUncertain = support.uncertain || supportOf(target).uncertain
      queue.push({
        pieceId: target.id, time: next.time + travel, causeId: event.id,
        detail: (piece.kind === 'splitter' ? '分岔臂接触' : piece.kind === 'ramp' ? '坡面末端接触' : '相邻接触')
          + (contactUncertain ? '（窄脊不确定）' : ''),
        uncertain: contactUncertain || undefined,
      })
    }

    const hasConnection = document.connections.some(link => link.from === piece.id && link.enabled)
    if (!target && !hasConnection && interruptedPieceId === null) {
      interruptedPieceId = piece.id
      interruptionReason = verdict.blockedUncertain
        ? '倒程压到窄脊（不确定边界），无法可靠判定接触，链路在此停止。'
        : verdict.blockedByTerrain
          ? '倒程被隆起的地形阻断，链路在此停止。'
          : verdict.uphill
            ? `下一件元件位于高出 ${verdict.uphill.dz.toFixed(2)} m 的坡面，倒程不足。`
            : '倒下方向内没有可触达的元件，链路在此停止。'
      const interrupted: SimulationEvent = {
        id: `event-${events.length + 1}`, pieceId: piece.id, time: next.time + 0.05,
        causeId: event.id, kind: 'interrupted', detail: interruptionReason,
        supportZ: Math.round(support.z * 1000) / 1000,
      }
      if (verdict.blockedUncertain) interrupted.uncertain = true
      events.push(interrupted)
    }
  }

  return {
    events,
    interruptedPieceId,
    interruptionReason,
    reachedTrigger,
    status: events.length === 0 ? 'empty' as const
      : interruptedPieceId || !reachedTrigger ? 'interrupted' as const : 'complete' as const,
    duration: events.at(-1)?.time ?? 0,
  }
}
