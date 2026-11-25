export type PieceKind = 'domino' | 'ramp' | 'splitter' | 'trigger'
export type Axis = 'north' | 'east' | 'south' | 'west'

export interface Vec2 { x: number; y: number }

export interface Piece {
  id: string
  kind: PieceKind
  x: number
  y: number
  angle: number
  facing: Axis
  label: string
  height: number
  width: number
  fallThreshold: number
  friction: number
}

export interface MechanismConnection {
  id: string
  from: string
  to: string
  delay: number
  enabled: boolean
}

export interface SceneSettings {
  gravity: number
  friction: number
  width: number
  height: number
  showGrid: boolean
}

/**
 * 场景地面的高度场。节点按行优先排列，覆盖整个桌面矩形，
 * 节点 (i, j) 位于 (i * cell, j * cell)，值为该点高程（米，可正可负）。
 * 元件支承高程始终由高度场派生，编辑地形后自动重新贴合。
 */
export interface TerrainField {
  cell: number
  cols: number
  rows: number
  heights: number[]
}

export interface DominoDocument {
  id: string
  title: string
  revision: number
  updatedAt: number
  pieces: Piece[]
  connections: MechanismConnection[]
  scene: SceneSettings
  terrain: TerrainField
  startPieceId: string
}

export interface SimulationEvent {
  id: string
  pieceId: string
  time: number
  causeId: string | null
  kind: 'trigger' | 'fall' | 'mechanism' | 'interrupted'
  detail: string
  /** 事件发生时元件的支承高程（米），由地形高度场派生。 */
  supportZ?: number
  /** 该事件的接触或支承依赖窄脊等不确定边界，结果仅供参考。 */
  uncertain?: boolean
}

export interface SimulationRun {
  id: string
  documentId: string
  revision: number
  startedAt: number
  startPieceId: string
  status: 'complete' | 'interrupted' | 'empty'
  events: SimulationEvent[]
  interruptedPieceId: string | null
  interruptionReason: string | null
  duration: number
}
