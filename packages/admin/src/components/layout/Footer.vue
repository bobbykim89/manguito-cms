<script setup lang="ts">
import { useUiStore } from '../../stores/ui'

const uiStore = useUiStore()
</script>

<template>
  <footer class="mt-10 border-t border-gray-200 px-1 py-5">
    <p class="text-xs text-gray-400">{{ uiStore.cmsName }}</p>
  </footer>
</template>
