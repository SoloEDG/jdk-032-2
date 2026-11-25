import type { Ref } from 'vue'
import type { DominoDocument, SceneSettings } from '@/shared/document'
import { resampleTerrain } from '../lib/terrain'

export function useScene(document: Ref<DominoDocument>, changed: () => void) {
  function update(patch: Partial<SceneSettings>) {
    const scene = { ...document.value.scene, ...patch }
    const terrain = patch.width !== undefined || patch.height !== undefined
      ? resampleTerrain(document.value.terrain, scene.width, scene.height)
      : document.value.terrain
    document.value = { ...document.value, scene, terrain }
    changed()
  }
  return { update }
}
