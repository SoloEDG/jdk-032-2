<script setup lang="ts">
import { RotateCw, Trash2 } from '@lucide/vue'
import type { Piece } from '@/shared/document'

defineProps<{ piece: Piece | null; support: { z: number; uncertain: boolean } | null }>()
const emit = defineEmits<{
  rotate: [string]; remove: [string]; update: [string, Partial<Pick<Piece, 'label' | 'height' | 'fallThreshold' | 'friction'>>]
}>()
function value(event: Event) { return (event.target as HTMLInputElement).value }
function number(event: Event) { return Number(value(event)) }
</script>

<template>
  <section class="inspector">
    <div class="section-kicker"><span>02 / SELECTED</span><h2>元件属性</h2></div>
    <template v-if="piece">
      <label class="field-label">名称<input :value="piece.label" maxlength="18" @change="emit('update', piece.id, { label: value($event) })" /></label>
      <div class="field-pair">
        <label class="field-label">横坐标<input type="number" :value="piece.x.toFixed(1)" step="0.1" readonly /></label>
        <label class="field-label">纵坐标<input type="number" :value="piece.y.toFixed(1)" step="0.1" readonly /></label>
      </div>
      <div v-if="support" class="support-row" :class="{ uncertain: support.uncertain }">
        <span>支承高程</span>
        <strong class="mono">{{ support.z >= 0 ? '+' : '' }}{{ support.z.toFixed(2) }} m</strong>
        <em v-if="support.uncertain">跨窄脊 · 支承不确定</em>
        <em v-else class="ok">贴合地面</em>
      </div>
      <label class="field-label">倾倒门槛 <span>{{ piece.fallThreshold.toFixed(1) }}</span>
        <input type="range" min="0.3" max="1.6" step="0.1" :value="piece.fallThreshold"
          @change="emit('update', piece.id, { fallThreshold: number($event) })" />
      </label>
      <div class="inspector-actions">
        <button @click="emit('rotate', piece.id)"><RotateCw :size="15" /> 旋转 15°</button>
        <button class="danger" @click="emit('remove', piece.id)"><Trash2 :size="15" /> 删除</button>
      </div>
      <p class="inspector-note">在场景中拖动，或使用方向键微调位置。支承高程随地面塑形自动贴合。</p>
    </template>
    <div v-else class="inspector-empty"><span class="empty-cross">＋</span><span>选择一个元件查看属性</span></div>
  </section>
</template>
