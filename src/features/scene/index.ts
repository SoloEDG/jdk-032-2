export { useScene } from './model/useScene'
export { useTerrain } from './model/useTerrain'
export { default as ScenePanel } from './ui/ScenePanel.vue'
export { clampToScene, isInsideScene, sceneArea } from './lib/bounds'
export {
  applyBrush,
  contactSpan,
  contourSegments,
  createFlatTerrain,
  crestMask,
  fallPathIntrusion,
  isTerrainValid,
  resampleTerrain,
  sampleHeight,
  stampLine,
  supportAt,
  terrainRelief,
  TERRAIN_CELL,
  TERRAIN_MAX_RELIEF,
} from './lib/terrain'
export type { SupportInfo } from './lib/terrain'
