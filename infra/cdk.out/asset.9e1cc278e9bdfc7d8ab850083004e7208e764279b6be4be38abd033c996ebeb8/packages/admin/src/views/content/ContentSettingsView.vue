<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useApiClient } from '../../composables/useApiClient'
import { useNotification } from '../../composables/useNotification'
import { useSchemaStore } from '../../stores/schema'

const route = useRoute()
const api = useApiClient()
const notify = useNotification()
const schemaStore = useSchemaStore()

const type = computed(() => route.params.type as string)
const contentType = computed(() => schemaStore.contentTypes[type.value])

// Available base paths fetched from the API at mount.
const availableRoutes = ref<string[]>([])
const selectedPath = ref('')
const loadingRoutes = ref(true)
const saving = ref(false)
const formError = ref('')

onMounted(async () => {
  // Seed with current path from schema.
  selectedPath.value = contentType.value?.default_base_path ?? ''

  const res = await api.get<string[]>('/routes')
  loadingRoutes.value = false

  if (res.ok) {
    availableRoutes.value = res.data
    // Ensure the current path appears even if not in the list.
    if (selectedPath.value && !availableRoutes.value.includes(selectedPath.value)) {
      availableRoutes.value = [selectedPath.value, ...availableRoutes.value]
    }
  } else {
    // If the routes endpoint isn't available, fall back to a free-text input.
    availableRoutes.value = []
  }
})

async function onSave() {
  if (!selectedPath.value.trim()) return
  saving.value = true
  formError.value = ''

  const res = await api.patch(`/content/${type.value}/settings`, {
    base_path: selectedPath.value.trim(),
  })

  saving.value = false

  if (!res.ok) {
    formError.value = (res as { ok: false; error: { message: string } }).error.message
    return
  }

  notify.success('Settings saved.')
}
</script>

<template>
  <div class="max-w-lg">
    <div class="mb-6">
      <h1 class="text-xl font-semibold text-gray-900">
        {{ contentType?.label ?? type }} — Settings
      </h1>
      <p class="mt-1 text-sm text-gray-500">
        Change the base path for this content type. This does not modify schema files.
      </p>
    </div>

    <div v-if="loadingRoutes" class="space-y-2">
      <div class="h-8 w-48 animate-pulse rounded bg-gray-100" />
      <div class="h-10 animate-pulse rounded bg-gray-100" />
    </div>

    <form v-else class="space-y-4" @submit.prevent="onSave">
      <div>
        <label for="base-path" class="block text-sm font-medium text-gray-700">
          Base path
        </label>

        <!-- Dropdown when routes are available -->
        <select
          v-if="availableRoutes.length > 0"
          id="base-path"
          v-model="selectedPath"
          :disabled="saving"
          class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option v-for="p in availableRoutes" :key="p" :value="p">
            {{ p }}
          </option>
        </select>

        <!-- Free-text fallback when routes endpoint not available -->
        <input
          v-else
          id="base-path"
          v-model="selectedPath"
          type="text"
          :disabled="saving"
          placeholder="/my-route"
          class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <p v-if="formError" class="text-sm text-red-600" role="alert">
        {{ formError }}
      </p>

      <button
        type="submit"
        :disabled="saving || !selectedPath.trim()"
        class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </form>
  </div>
</template>
