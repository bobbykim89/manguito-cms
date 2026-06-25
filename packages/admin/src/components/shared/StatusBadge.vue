<script setup lang="ts">
defineProps<{ published: boolean }>()
</script>

<template>
  <span
    :class="[
      'inline-flex items-center rounded-full px-[11px] py-1 text-xs font-semibold',
      published ? 'bg-[#E7F6EC] text-[#1E8E4E]' : 'bg-[#FBF1DF] text-[#B5790E]',
    ]"
  >
    {{ published ? 'Published' : 'Draft' }}
  </span>
</template>
