<script setup lang="ts">
defineProps<{ published: boolean }>()
</script>

<template>
  <span
    :class="[
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      published ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600',
    ]"
  >
    {{ published ? 'Published' : 'Draft' }}
  </span>
</template>
