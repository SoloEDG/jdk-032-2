<script setup lang="ts">
import { Mountain, Ruler, SunMedium, TrendingDown, TrendingUp, Undo2 } from '@lucide/vue'
import type { SceneSettings } from '@/shared/document'
import type { TerrainMode } from '../model/useTerrain'

defineProps<{
  scene: SceneSettings
  terrainMode: TerrainMode | null
  brushRadius: number
  brushStrength: number
  terrainStats: { min: number; max: number; seated: number; crestCells: number }
}>()
const emit = defineEmits<{
  update: [Partial<SceneSettings>]
  setTerrainMode: [TerrainMode | null]
  setBrushRadius: [number]
  setBrushStrength: [number]
  resetTerrain: []
}>()
function number(event: Event) { return Number((event.target as HTMLInputElement).value) }
</script>

<template>
  <section class="scene-panel">
    <div class="section-kicker"><span>04 / SCENE</span><h2>场景控制</h2></div>
    <div class="scene-dimensions"><Ruler :size="16" /><strong>{{ scene.width }} × {{ scene.height }}</strong><span>米</span></div>
    <label class="field-label"><span><SunMedium :size="14" /> 重力</span><span>{{ scene.gravity.toFixed(1) }} m/s²</span>
      <input type="range" min="3" max="16" step="0.1" :value="scene.gravity" @change="emit('update', { gravity: number($event) })" />
    </label>
    <label class="field-label"><span><Mountain :size="14" /> 地面摩擦</span><span>{{ scene.friction.toFixed(2) }}</span>
      <input type="range" min="0.15" max="0.95" step="0.01" :value="scene.friction" @change="emit('update', { friction: number($event) })" />
    </label>
    <label class="grid-switch"><span>显示定位网格</span><input type="checkbox" :checked="scene.showGrid" @change="emit('update', { showGrid: ($event.target as HTMLInputElement).checked })" /><i></i></label>

    <div class="terrain-section">
      <div class="terrain-head"><Mountain :size="14" /> 地面塑形</div>
      <div class="terrain-modes">
        <button :class="{ chosen: terrainMode === 'raise' }" :aria-pressed="terrainMode === 'raise'"
          @click="emit('setTerrainMode', terrainMode === 'raise' ? null : 'raise')">
          <TrendingUp :size="13" /> 抬高
        </button>
        <button :class="{ chosen: terrainMode === 'lower' }" :aria-pressed="terrainMode === 'lower'"
          @click="emit('setTerrainMode', terrainMode === 'lower' ? null : 'lower')">
          <TrendingDown :size="13" /> 压低
        </button>
      </div>
      <label class="field-label"><span>笔刷半径</span><span>{{ brushRadius.toFixed(1) }} m</span>
        <input type="range" min="0.3" max="2.4" step="0.1" :value="brushRadius"
          @input="emit('setBrushRadius', number($event))" />
      </label>
      <label class="field-label"><span>每笔强度</span><span>{{ brushStrength.toFixed(2) }} m</span>
        <input type="range" min="0.02" max="0.24" step="0.01" :value="brushStrength"
          @input="emit('setBrushStrength', number($event))" />
      </label>
      <button class="terrain-reset" @click="emit('resetTerrain')"><Undo2 :size="13" /> 恢复平地</button>
      <p class="terrain-stats">
        <template v-if="terrainStats.max - terrainStats.min > 0.015">
          起伏 {{ terrainStats.min.toFixed(2) }} ~ +{{ terrainStats.max.toFixed(2) }} m · {{ terrainStats.seated }} 件元件已贴合坡面<template v-if="terrainStats.crestCells"> · 不确定边界 {{ terrainStats.crestCells }} 格</template>
        </template>
        <template v-else>地面平整。选择「抬高 / 压低」后在桌面拖动，可做出缓坡、窄脊与凹槽。</template>
      </p>
      <p class="terrain-legend"><span class="legend-swatch"></span><span>窄于一枚牌的凸脊会标为斜纹不确定边界：模拟不会把它当作可靠支承，也不会让链路悄悄穿过。</span></p>
    </div>
  </section>
</template>
