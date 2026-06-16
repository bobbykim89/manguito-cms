<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import type { Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { useApiClient } from '../../composables/useApiClient'
import { usePermission } from '../../composables/usePermission'
import { useFormValidation } from '../../composables/useFormValidation'
import { useNotification } from '../../composables/useNotification'
import { useSchemaStore } from '../../stores/schema'
import { useTaxonomyStore } from '../../stores/taxonomy'
import TextInput from '../../components/fields/TextInput.vue'
import RichTextEditor from '../../components/fields/RichTextEditor.vue'
import NumberInput from '../../components/fields/NumberInput.vue'
import BooleanToggle from '../../components/fields/BooleanToggle.vue'
import DatePicker from '../../components/fields/DatePicker.vue'
import EnumSelect from '../../components/fields/EnumSelect.vue'
import ConfirmDialog from '../../components/shared/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()
const api = useApiClient()
const { can } = usePermission()
const { errors, validate, mergeServerErrors, clearErrors, setError } = useFormValidation()
const notify = useNotification()
const schemaStore = useSchemaStore()
const taxonomyStore = useTaxonomyStore()

// ── Route ─────────────────────────────────────────────────────────────────────

const type = computed(() => route.params.type as string)
const routeId = computed(() => route.params.id as string | undefined)
const isEdit = computed(() => !!routeId.value)

// ── Schema ────────────────────────────────────────────────────────────────────

const taxonomyType = computed(() => schemaStore.taxonomyTypes[type.value])
const allFields = computed(() => taxonomyType.value?.fields ?? [])

// ── Form state ────────────────────────────────────────────────────────────────

const item = ref<Record<string, unknown> | null>(null)
const form = ref<Record<string, unknown>>({})
const loading = ref(true)
const saving = ref(false)
const formError = ref('')
const showDeleteConfirm = ref(false)

// ── Field component mapping (flat — no paragraphs, media, or references in taxonomy) ──

const FIELD_COMP = {
  'text/plain': TextInput,
  'text/rich': RichTextEditor,
  integer: NumberInput,
  float: NumberInput,
  boolean: BooleanToggle,
  date: DatePicker,
  enum: EnumSelect,
} as const

function componentFor(field: ParsedField): Component {
  const key = field.field_type as keyof typeof FIELD_COMP
  return FIELD_COMP[key] ?? TextInput
}

// ── Form helpers ──────────────────────────────────────────────────────────────

function defaultForField(field: ParsedField): unknown {
  switch (field.field_type) {
    case 'text/plain':
    case 'text/rich':
      return ''
    case 'integer':
    case 'float':
      return null
    case 'boolean':
      return false
    case 'date':
      return null
    case 'enum':
      return ''
    default:
      return null
  }
}

function initForm(source?: Record<string, unknown>) {
  const f: Record<string, unknown> = {}
  for (const field of allFields.value) {
    f[field.name] = source?.[field.name] ?? defaultForField(field)
  }
  form.value = f
}

function updateField(name: string, value: unknown) {
  form.value[name] = value
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadItem(id: string) {
  const res = await api.get<Record<string, unknown>>(`/taxonomy/${type.value}/${id}`)
  if (res.ok) {
    item.value = res.data
    initForm(res.data)
  } else {
    formError.value = res.error.message
  }
}

onMounted(async () => {
  if (!taxonomyType.value) {
    loading.value = false
    return
  }
  if (isEdit.value && routeId.value) {
    await loadItem(routeId.value)
  } else {
    initForm()
  }
  loading.value = false
})

watch(routeId, async (newId, oldId) => {
  if (newId === oldId) return
  loading.value = true
  clearErrors()
  if (newId) {
    await loadItem(newId)
  } else {
    item.value = null
    initForm()
  }
  loading.value = false
})

// ── Save / delete ─────────────────────────────────────────────────────────────

async function onSave() {
  const valid = validate(allFields.value, form.value)
  if (!valid) return

  saving.value = true
  formError.value = ''

  const res = isEdit.value
    ? await api.patch<Record<string, unknown>>(
        `/taxonomy/${type.value}/${routeId.value!}`,
        form.value
      )
    : await api.post<Record<string, unknown>>(`/taxonomy/${type.value}`, form.value)

  saving.value = false

  if (!res.ok) {
    const raw = res.error as {
      code: string
      message: string
      details?: Array<{ field: string; message: string }>
    }
    if (raw.code === 'PUBLISH_VALIDATION_ERROR' && raw.details) {
      mergeServerErrors(raw.details)
    } else if (raw.code === 'SLUG_CONFLICT') {
      setError('slug', 'This slug is already taken.')
    } else {
      formError.value = raw.message
    }
    return
  }

  item.value = res.data
  taxonomyStore.invalidate(type.value)
  notify.success('Saved.')

  if (!isEdit.value) {
    void router.replace({
      name: 'taxonomy-edit',
      params: { type: type.value, id: String(res.data.id) },
    })
  }
}

async function doDelete() {
  showDeleteConfirm.value = false
  saving.value = true
  const res = await api.del(`/taxonomy/${type.value}/${routeId.value!}`)
  saving.value = false

  if (!res.ok) {
    formError.value = (res as { ok: false; error: { message: string } }).error.message
    return
  }

  taxonomyStore.invalidate(type.value)
  void router.push({ name: 'taxonomy-list', params: { type: type.value } })
}

// ── Page title ────────────────────────────────────────────────────────────────

const pageTitle = computed(() => {
  if (!isEdit.value) return `New ${taxonomyType.value?.label ?? ''}`
  const tf = allFields.value.find(f => f.field_type === 'text/plain')
  return tf ? String(item.value?.[tf.name] ?? '') : (taxonomyType.value?.label ?? '')
})
</script>

<template>
  <!-- Loading -->
  <div v-if="loading" class="flex items-center justify-center py-20">
    <span
      class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"
      aria-hidden="true"
    />
  </div>

  <div v-else-if="!taxonomyType" class="py-12 text-center text-sm text-gray-500">
    Taxonomy type not found.
  </div>

  <div v-else>
    <!-- Page header -->
    <div class="mb-6 flex items-start justify-between gap-4">
      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-gray-400">
          {{ taxonomyType.label }}
        </p>
        <h1 class="text-xl font-semibold text-gray-900">{{ pageTitle }}</h1>
      </div>

      <!-- Action bar -->
      <div class="flex shrink-0 items-center gap-2">
        <button
          v-if="can('taxonomy:delete') && isEdit"
          type="button"
          :disabled="saving"
          class="rounded-md px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-inset ring-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          @click="showDeleteConfirm = true"
        >
          Delete
        </button>

        <button
          v-if="isEdit ? can('taxonomy:edit') : can('taxonomy:create')"
          type="button"
          :disabled="saving"
          class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          @click="onSave"
        >
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>

    <!-- Flat field layout — no tabs, no slug, no publish toggle -->
    <div class="space-y-5">
      <component
        :is="componentFor(field)"
        v-for="field in allFields"
        :key="field.name"
        :field="field"
        :model-value="form[field.name]"
        :error="errors[field.name]"
        :disabled="saving"
        @update:model-value="updateField(field.name, $event)"
      />
    </div>

    <!-- Form-level error -->
    <p v-if="formError" class="mt-4 text-sm text-red-600" role="alert">
      {{ formError }}
    </p>

    <!-- Delete confirmation -->
    <ConfirmDialog
      v-if="showDeleteConfirm"
      message="Are you sure you want to delete this term? This action cannot be undone."
      :on-confirm="doDelete"
      :on-cancel="() => (showDeleteConfirm = false)"
    />
  </div>
</template>
