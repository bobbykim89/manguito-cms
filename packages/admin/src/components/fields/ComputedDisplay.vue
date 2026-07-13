<!-- Read-only placeholder for a programmatic field. The value is computed at
     read time by the public API, so the admin shows the label only and never
     contributes this field to the submit payload. -->
<script setup lang="ts">
defineProps<{
  field: { label: string }
}>()
</script>

<template>
  <div>
    <label class="block text-[13px] font-semibold text-[#3D3D52]">
      {{ field.label }}
    </label>

    <p class="mt-1 text-sm text-gray-500">Computed at read time</p>
  </div>
</template>
