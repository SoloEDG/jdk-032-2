import { computed, ref, type Ref } from 'vue'
import type { DominoDocument, Vec2 } from '@/shared/document'
import {
  createFlatTerrain,
  crestMask,
  stampLine,
  supportAt,
  terrainRelief,
} from '../lib/terrain'

export type TerrainMode = 'raise' | 'lower'

export function useTerrain(document: Ref<DominoDocument>, changed: () => void) {
  const mode = ref<TerrainMode | null>(null)
  const radius = ref(0.9)
  const strength = ref(0.09)
  let last: Vec2 | null = null

  function setMode(next: TerrainMode | null) {
    mode.value = next
    last = null
  }
  function setRadius(value: number) {
    radius.value = Math.max(0.3, Math.min(2.4, value))
  }
  function setStrength(value: number) {
    strength.value = Math.max(0.02, Math.min(0.24, value))
  }

  function beginStroke() { last = null }

  function strokeTo(x: number, y: number) {
    if (!mode.value) return
    const from = last ?? { x, y }
    const delta = (mode.value === 'raise' ? 1 : -1) * strength.value
    document.value = {
      ...document.value,
      terrain: stampLine(document.value.terrain, from, { x, y }, radius.value, delta),
    }
    last = { x, y }
    changed()
  }

  function endStroke() { last = null }

  function reset() {
    document.value = {
      ...document.value,
      terrain: createFlatTerrain(document.value.scene.width, document.value.scene.height),
    }
    changed()
  }

  const stats = computed(() => {
    const terrain = document.value.terrain
    const relief = terrainRelief(terrain)
    const crests = crestMask(terrain)
    let crestCells = 0
    for (const flag of crests) crestCells += flag
    const seated = document.value.pieces.filter(piece => {
      const support = supportAt(terrain, piece.x, piece.y, piece.width / 2, crests)
      return Math.abs(support.z) >= 0.02
    }).length
    return { min: relief.min, max: relief.max, seated, crestCells }
  })

  return { mode, radius, strength, setMode, setRadius, setStrength, beginStroke, strokeTo, endStroke, reset, stats }
}
