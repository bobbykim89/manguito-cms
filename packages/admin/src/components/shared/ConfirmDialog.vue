<script setup lang="ts">
defineProps<{
  message: string
  onConfirm: () => void
  onCancel: () => void
}>()
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
    >
      <div class="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <p class="text-sm text-gray-700">{{ message }}</p>

        <div class="mt-6 flex justify-end gap-3">
          <button
            type="button"
            class="rounded-md px-4 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
            @click="onCancel"
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            @click="onConfirm"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
