<script setup lang="ts">
import { computed, ref } from 'vue'
import { Crosshair, MousePointer2, Mountain } from '@lucide/vue'
import type { DominoDocument, Piece, PieceKind, SimulationRun, Vec2 } from '@/shared/document'
import { contourSegments, crestMask, supportAt, terrainRelief, type SupportInfo } from '@/features/scene/lib/terrain'

const props = defineProps<{
  document: DominoDocument; activeTool: PieceKind | null; selectedId: string | null
  run: SimulationRun | null; focusPieceId: string | null
  terrainEditing: boolean; brushRadius: number
}>()
const emit = defineEmits<{
  place: [PieceKind, number, number]; select: [string | null]; move: [string, number, number]
  brush: [number, number, 'start' | 'move' | 'end']
}>()
const svg = ref<SVGSVGElement | null>(null)
const view = { width: 1040, height: 510, margin: 35 }
const fallen = computed(() => new Set(props.run?.events.filter(event => event.kind === 'fall').map(event => event.pieceId) ?? []))
const failed = computed(() => props.run?.interruptedPieceId ?? null)
let dragging: string | null = null
let brushing = false
const hover = ref<Vec2 | null>(null)

const scaleX = computed(() => (view.width - view.margin * 2) / props.document.scene.width)
const scaleY = computed(() => (view.height - view.margin * 2) / props.document.scene.height)

const relief = computed(() => terrainRelief(props.document.terrain))
const hasRelief = computed(() => relief.value.max - relief.value.min > 0.015)

const tintCells = computed(() => {
  const terrain = props.document.terrain
  const cells: { x: number; y: number; h: number }[] = []
  for (let j = 0; j < terrain.rows - 1; j++) {
    for (let i = 0; i < terrain.cols - 1; i++) {
      const h = (terrain.heights[j * terrain.cols + i] + terrain.heights[j * terrain.cols + i + 1]
        + terrain.heights[(j + 1) * terrain.cols + i] + terrain.heights[(j + 1) * terrain.cols + i + 1]) / 4
      if (Math.abs(h) < 0.015) continue
      cells.push({ x: i * terrain.cell, y: j * terrain.cell, h })
    }
  }
  return cells
})

function terrainTint(h: number) {
  const t = Math.min(1, Math.abs(h) / 1.2)
  return h > 0 ? `rgba(198, 156, 92, ${0.1 + t * 0.38})` : `rgba(86, 146, 152, ${0.09 + t * 0.32})`
}

const CONTOUR_LEVELS = [-1.2, -0.9, -0.6, -0.3, 0.3, 0.6, 0.9, 1.2]
const contours = computed(() => {
  const terrain = props.document.terrain
  return CONTOUR_LEVELS
    .map(level => {
      const segments = contourSegments(terrain, level)
      let d = ''
      for (let k = 0; k + 3 < segments.length; k += 4) {
        d += `M${segments[k].toFixed(2)} ${segments[k + 1].toFixed(2)}L${segments[k + 2].toFixed(2)} ${segments[k + 3].toFixed(2)}`
      }
      return { level, d }
    })
    .filter(entry => entry.d)
})

const crests = computed(() => crestMask(props.document.terrain))
const crestCells = computed(() => {
  const terrain = props.document.terrain
  const cells: { x: number; y: number }[] = []
  for (let j = 0; j < terrain.rows; j++) {
    for (let i = 0; i < terrain.cols; i++) {
      if (crests.value[j * terrain.cols + i] === 1) cells.push({ x: i * terrain.cell, y: j * terrain.cell })
    }
  }
  return cells
})

const supports = computed(() => {
  const map = new Map<string, SupportInfo>()
  for (const piece of props.document.pieces) {
    map.set(piece.id, supportAt(props.document.terrain, piece.x, piece.y, piece.width / 2, crests.value))
  }
  return map
})
function supportOf(id: string) { return supports.value.get(id) ?? null }
function zLabel(id: string) {
  const support = supports.value.get(id)
  if (!support || Math.abs(support.z) < 0.02) return ''
  return `${support.z > 0 ? '+' : '−'}${Math.abs(support.z).toFixed(1)}`
}

function worldPoint(event: PointerEvent) {
  if (!svg.value) return { x: 0, y: 0 }
  const bounds = svg.value.getBoundingClientRect()
  const svgX = (event.clientX - bounds.left) / bounds.width * view.width
  const svgY = (event.clientY - bounds.top) / bounds.height * view.height
  return {
    x: Math.max(0, Math.min(props.document.scene.width,
      (svgX - view.margin) / (view.width - view.margin * 2) * props.document.scene.width)),
    y: Math.max(0, Math.min(props.document.scene.height,
      (svgY - view.margin) / (view.height - view.margin * 2) * props.document.scene.height)),
  }
}

function down(event: PointerEvent, piece: Piece) {
  if (props.terrainEditing) return
  event.stopPropagation()
  dragging = piece.id
  emit('select', piece.id)
  ;(event.currentTarget as SVGGElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  const point = worldPoint(event)
  hover.value = point
  if (brushing) {
    emit('brush', point.x, point.y, 'move')
    return
  }
  if (!dragging) return
  emit('move', dragging, point.x, point.y)
}
function up(event: PointerEvent) {
  if (brushing) {
    const point = worldPoint(event)
    emit('brush', point.x, point.y, 'end')
  }
  brushing = false
  dragging = null
}
function boardClick(event: PointerEvent) {
  if (dragging) return
  const point = worldPoint(event)
  if (props.terrainEditing) {
    brushing = true
    svg.value?.setPointerCapture(event.pointerId)
    emit('brush', point.x, point.y, 'start')
    return
  }
  if (props.activeTool) emit('place', props.activeTool, point.x, point.y)
  else emit('select', null)
}
function pxX(x: number) { return view.margin + x / props.document.scene.width * (view.width - view.margin * 2) }
function pxY(y: number) { return view.margin + y / props.document.scene.height * (view.height - view.margin * 2) }
function pieceColor(piece: Piece) {
  if (piece.id === failed.value) return '#e88b69'
  if (fallen.value.has(piece.id)) return '#89c5a5'
  if (piece.kind === 'ramp') return '#8ca6a0'
  if (piece.kind === 'splitter') return '#e6bd68'
  if (piece.kind === 'trigger') return '#df8d70'
  return '#ead8b5'
}
function eventTime(pieceId: string) {
  const event = props.run?.events.find(item => item.pieceId === pieceId)
  return event ? event.time.toFixed(2) : ''
}
</script>

<template>
  <section class="stage-panel" aria-label="骨牌构筑场景">
    <div class="stage-toolbar">
      <div class="stage-mode"><Mountain v-if="terrainEditing" :size="15" /><MousePointer2 v-else :size="15" /><span>{{ terrainEditing ? '塑形地面：拖动抬升或压低' : activeTool ? '点击空位添加元件' : '编辑场景' }}</span></div>
      <div class="stage-readout"><span class="readout-dot"></span>{{ document.pieces.length }} 件元件 <span class="readout-sep">·</span> {{ document.scene.width }} × {{ document.scene.height }} 桌面 <template v-if="hasRelief"><span class="readout-sep">·</span> 起伏 {{ relief.min.toFixed(1) }} ~ +{{ relief.max.toFixed(1) }} m</template></div>
    </div>
    <svg ref="svg" class="stage-svg" :class="{ 'terrain-editing': terrainEditing }" :viewBox="`0 0 ${view.width} ${view.height}`" role="img"
      aria-label="可编辑的多米诺场景。使用鼠标拖动或方向键微调选中元件。" @pointerup="up" @pointercancel="up"
      @pointermove="move" @pointerdown="boardClick" @pointerleave="hover = null">
      <defs>
        <pattern id="draft-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#3c5048" stroke-width=".65" opacity=".6" />
          <circle cx="0" cy="0" r="1" fill="#b9c3a5" opacity=".3" />
        </pattern>
        <pattern id="draft-fine" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".65" fill="#758376" opacity=".35" />
        </pattern>
        <pattern id="crest-hatch" width="0.14" height="0.14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="0.14" height="0.14" fill="rgba(230, 189, 104, 0.07)" />
          <line x1="0" y1="0" x2="0" y2="0.14" stroke="#e6bd68" stroke-width="0.035" opacity="0.6" />
        </pattern>
        <filter id="piece-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="1" dy="3" stdDeviation="2" flood-color="#101a17" flood-opacity=".38" />
        </filter>
      </defs>
      <rect x="0" y="0" :width="view.width" :height="view.height" rx="12" class="board-bg" />
      <rect :x="view.margin" :y="view.margin" :width="view.width-view.margin*2" :height="view.height-view.margin*2" rx="7" class="board-surface" />
      <g class="terrain-layer" :transform="`translate(${view.margin} ${view.margin}) scale(${scaleX} ${scaleY})`" pointer-events="none">
        <rect v-for="(cell, index) in tintCells" :key="index" :x="cell.x" :y="cell.y"
          :width="document.terrain.cell + 0.02" :height="document.terrain.cell + 0.02" :fill="terrainTint(cell.h)" />
        <path v-for="contour in contours" :key="contour.level" :d="contour.d" class="terrain-contour" vector-effect="non-scaling-stroke" />
        <rect v-for="(cell, index) in crestCells" :key="`c${index}`" :x="cell.x - document.terrain.cell * 0.51" :y="cell.y - document.terrain.cell * 0.51"
          :width="document.terrain.cell * 1.02" :height="document.terrain.cell * 1.02" fill="url(#crest-hatch)" />
      </g>
      <rect :x="view.margin" :y="view.margin" :width="view.width-view.margin*2" :height="view.height-view.margin*2" rx="7" fill="url(#draft-fine)" pointer-events="none" />
      <path v-if="document.scene.showGrid" :d="`M ${view.margin} ${view.height/2} H ${view.width-view.margin} M ${view.width/2} ${view.margin} V ${view.height-view.margin}`" class="center-guide" pointer-events="none" />

      <g v-for="connection in document.connections.filter(link => link.enabled)" :key="connection.id" class="mechanism-link" pointer-events="none">
        <path :d="`M ${pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)} ${pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)} Q ${(pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)+pxX(document.pieces.find(piece => piece.id === connection.to)?.x ?? 0))/2} ${(pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)+pxY(document.pieces.find(piece => piece.id === connection.to)?.y ?? 0))/2-36} ${pxX(document.pieces.find(piece => piece.id === connection.to)?.x ?? 0)} ${pxY(document.pieces.find(piece => piece.id === connection.to)?.y ?? 0)}`" />
        <circle :cx="pxX(document.pieces.find(piece => piece.id === connection.from)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === connection.from)?.y ?? 0)" r="3" />
      </g>

      <g v-for="piece in document.pieces" :key="piece.id" class="scene-piece"
        :class="{ selected: selectedId === piece.id, focused: focusPieceId === piece.id, fallen: fallen.has(piece.id) }"
        :transform="`translate(${pxX(piece.x)} ${pxY(piece.y)})`"
        :tabindex="0" role="button" :aria-label="`${piece.label}，${piece.x.toFixed(1)}，${piece.y.toFixed(1)}`" :aria-pressed="selectedId === piece.id"
        @pointerdown="down($event, piece)" @keydown.enter.stop="emit('select', piece.id)" @keydown.space.stop.prevent="emit('select', piece.id)">
        <ellipse v-if="supportOf(piece.id)?.uncertain" cx="0" cy="7" rx="17" ry="9" class="support-uncertain" />
        <g :transform="`rotate(${piece.angle})`">
          <ellipse v-if="piece.kind === 'domino'" cx="0" cy="7" rx="15" ry="8" class="piece-ground-shadow" />
          <rect v-if="piece.kind === 'domino'" x="-9" y="-20" width="18" height="39" rx="4" :fill="pieceColor(piece)" class="domino-body" filter="url(#piece-shadow)" />
          <path v-else-if="piece.kind === 'ramp'" d="M-24 10 L22 10 L22 -10 Z" :fill="pieceColor(piece)" class="ramp-body" filter="url(#piece-shadow)" />
          <path v-else-if="piece.kind === 'splitter'" d="M0-13 L13 0 L0 13 L-13 0 Z" :fill="pieceColor(piece)" class="splitter-body" filter="url(#piece-shadow)" />
          <circle v-else r="11" :fill="pieceColor(piece)" class="trigger-body" filter="url(#piece-shadow)" />
          <line v-if="piece.kind === 'domino'" x1="0" y1="-15" x2="0" y2="14" class="domino-mark" />
          <circle v-if="piece.id === document.startPieceId" cy="-28" r="4" class="start-marker" />
          <circle v-if="piece.id === failed" cy="-34" r="7" class="failure-marker" />
          <text y="32" text-anchor="middle" class="piece-label">{{ piece.label }}</text>
          <text v-if="eventTime(piece.id)" y="44" text-anchor="middle" class="piece-time">{{ eventTime(piece.id) }}s</text>
          <rect v-if="selectedId === piece.id || focusPieceId === piece.id" x="-18" y="-28" width="36" height="55" rx="8" class="selection-ring" />
        </g>
        <g v-if="zLabel(piece.id)" class="piece-z" transform="translate(15 -30)">
          <rect x="-13" y="-6" width="26" height="11" rx="2.5" />
          <text y="2" text-anchor="middle">{{ zLabel(piece.id) }}</text>
        </g>
      </g>

      <g v-if="focusPieceId" class="focus-reticle" pointer-events="none">
        <circle :cx="pxX(document.pieces.find(piece => piece.id === focusPieceId)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === focusPieceId)?.y ?? 0)" r="25" />
        <circle :cx="pxX(document.pieces.find(piece => piece.id === focusPieceId)?.x ?? 0)" :cy="pxY(document.pieces.find(piece => piece.id === focusPieceId)?.y ?? 0)" r="32" />
      </g>
      <circle v-if="terrainEditing && hover" :cx="pxX(hover.x)" :cy="pxY(hover.y)" :r="brushRadius * scaleX" class="brush-cursor" pointer-events="none" />
      <g class="board-scale" pointer-events="none"><path d="M 0 0 H 80 M 0 0 V -5 M 80 0 V -5" /><text x="40" y="15" text-anchor="middle">2 M</text></g>
    </svg>
    <div class="stage-footer">
      <span><Crosshair :size="13" /> 桌面定位</span>
      <span v-if="crestCells.length" class="legend-crest"><i></i>窄脊不确定边界 {{ crestCells.length }} 格</span>
      <span>{{ terrainEditing ? '拖动塑形 · 慢拖堆得更高' : '拖动摆放' }} <kbd>↑ ↓ ← →</kbd> 微调 <kbd>Shift</kbd> 加速</span>
    </div>
  </section>
</template>
