<script setup lang="ts">
import { ref, computed, onMounted, watch, defineComponent, h, markRaw } from 'vue'
import type { Component, PropType } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { useApiClient } from '../../composables/useApiClient'
import { usePermission } from '../../composables/usePermission'
import { useFormValidation } from '../../composables/useFormValidation'
import { useNotification } from '../../composables/useNotification'
import { useSchemaStore } from '../../stores/schema'
import { useContentStore } from '../../stores/content'
import TextInput from '../../components/fields/TextInput.vue'
import RichTextEditor from '../../components/fields/RichTextEditor.vue'
import NumberInput from '../../components/fields/NumberInput.vue'
import BooleanToggle from '../../components/fields/BooleanToggle.vue'
import DatePicker from '../../components/fields/DatePicker.vue'
import MediaUpload from '../../components/fields/MediaUpload.vue'
import EnumSelect from '../../components/fields/EnumSelect.vue'
import ReferenceSelect from '../../components/fields/ReferenceSelect.vue'
import ParagraphEmbed from '../../components/fields/ParagraphEmbed.vue'
import ComputedDisplay from '../../components/fields/ComputedDisplay.vue'
import ConfirmDialog from '../../components/shared/ConfirmDialog.vue'
import { useTabIndicator } from '../../composables/useTabIndicator'

const route = useRoute()
const router = useRouter()
const api = useApiClient()
const { can } = usePermission()
const { errors, validate, mergeServerErrors, clearErrors, setError } = useFormValidation()
const notify = useNotification()
const schemaStore = useSchemaStore()
const contentStore = useContentStore()

// ── Route params ──────────────────────────────────────────────────────────────

const type = computed(() => route.params.type as string)
const routeId = computed(() => route.params.id as string | undefined)

// ── Schema ────────────────────────────────────────────────────────────────────

const contentType = computed(() => schemaStore.contentTypes[type.value])
const allFields = computed(() => contentType.value?.fields ?? [])
const tabs = computed(() => contentType.value?.ui.tabs ?? [])

// ── Mode ──────────────────────────────────────────────────────────────────────

const isSingleton = computed(() => contentType.value?.only_one === true)
const mode = computed<'create' | 'edit' | 'singleton'>(() => {
  if (isSingleton.value) return 'singleton'
  if (!routeId.value) return 'create'
  return 'edit'
})

// ── Form state ────────────────────────────────────────────────────────────────

const item = ref<Record<string, unknown> | null>(null)
const form = ref<Record<string, unknown>>({})
const isPublished = ref(false)
const originalSlug = ref('')
const slugUnlocked = ref(false)

const loading = ref(true)
const saving = ref(false)
const formError = ref('')

const showSlugConfirm = ref(false)
const showDeleteConfirm = ref(false)
const pendingAction = ref<(() => Promise<void>) | null>(null)

// Active tab index
const activeTabIndex = ref(0)
const activeTabId = computed(() => tabs.value[activeTabIndex.value]?.name ?? '')
const tabBarRef = ref<HTMLElement | null>(null)
const { left: tabIndLeft, width: tabIndWidth } = useTabIndicator(tabBarRef, activeTabId)
const activeTabFields = computed<ParsedField[]>(() => {
  if (tabs.value.length === 0) return allFields.value
  const tab = tabs.value[activeTabIndex.value]
  if (!tab) return allFields.value
  return tab.fields
    .map(name => allFields.value.find(f => f.name === name))
    .filter((f): f is ParsedField => f !== undefined)
})

const slugChanged = computed(
  () =>
    mode.value === 'edit' &&
    isPublished.value &&
    (form.value.slug as string | undefined) !== originalSlug.value
)

// ── Field component mapping ───────────────────────────────────────────────────

const FIELD_COMP: Record<string, Component> = {
  'text/plain': markRaw(TextInput),
  'text/rich': markRaw(RichTextEditor),
  integer: markRaw(NumberInput),
  float: markRaw(NumberInput),
  boolean: markRaw(BooleanToggle),
  date: markRaw(DatePicker),
  image: markRaw(MediaUpload),
  video: markRaw(MediaUpload),
  file: markRaw(MediaUpload),
  enum: markRaw(EnumSelect),
  reference: markRaw(ReferenceSelect),
  paragraph: markRaw(ParagraphEmbed),
  programmatic: markRaw(ComputedDisplay),
}

function componentFor(field: ParsedField): Component {
  return FIELD_COMP[field.field_type] ?? FIELD_COMP['text/plain']!
}

// ── Paragraph form factory (render function — no runtime compiler needed) ─────

const paragraphFormCache = new Map<string, Component>()

function getParagraphForm(schemaName: string): Component {
  if (paragraphFormCache.has(schemaName)) {
    return paragraphFormCache.get(schemaName)!
  }

  const comp = markRaw(
    defineComponent({
      name: `ParagraphForm_${schemaName}`,
      props: {
        modelValue: {
          type: Object as PropType<Record<string, unknown>>,
          default: () => ({}),
        },
        disabled: { type: Boolean, default: false },
      },
      emits: ['update:modelValue'],
      setup(props, { emit }) {
        const store = useSchemaStore()
        const schema = computed(() => store.paragraphTypes[schemaName])

        function update(name: string, val: unknown) {
          emit('update:modelValue', { ...props.modelValue, [name]: val })
        }

        return () => {
          if (!schema.value) return h('div', { class: 'text-sm text-gray-400' }, 'Unknown paragraph type')
          return h(
            'div',
            { class: 'space-y-3' },
            schema.value.fields.map(field => {
              const c = FIELD_COMP[field.field_type] ?? FIELD_COMP['text/plain']!
              return h(c as Parameters<typeof h>[0], {
                key: field.name,
                field,
                modelValue: (props.modelValue ?? {})[field.name],
                disabled: props.disabled,
                'onUpdate:modelValue': (v: unknown) => update(field.name, v),
              })
            })
          )
        }
      },
    })
  )

  paragraphFormCache.set(schemaName, comp)
  return comp
}

// Extra props injected into paragraph fields.
function fieldExtraProps(field: ParsedField): Record<string, unknown> {
  if (field.ui_component.component === 'paragraph-embed') {
    return { formComponent: getParagraphForm(field.ui_component.ref) }
  }
  return {}
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
    case 'image':
    case 'video':
    case 'file':
      return null
    case 'enum':
      return ''
    case 'reference': {
      const rel =
        field.ui_component.component === 'typeahead-select'
          ? field.ui_component.rel
          : 'one-to-one'
      return rel === 'one-to-one' ? null : []
    }
    case 'paragraph':
      return []
    default:
      return null
  }
}

function initForm(source?: Record<string, unknown>) {
  const f: Record<string, unknown> = {}
  if (!isSingleton.value) {
    f.slug = source?.slug ?? ''
  }
  for (const field of allFields.value) {
    // Programmatic fields are computed at read time — never edited or submitted,
    // so they stay out of the form state (and therefore the save payload).
    if (field.field_type === 'programmatic') continue
    f[field.name] = source?.[field.name] ?? defaultForField(field)
  }
  form.value = f
  isPublished.value = source?.published === true
  if (source?.slug) originalSlug.value = String(source.slug)
}

function updateField(name: string, value: unknown) {
  form.value[name] = value
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadItem(id: string) {
  const res = await api.get<Record<string, unknown>>(`/content/${type.value}/${id}`)
  if (res.ok) {
    item.value = res.data
    initForm(res.data)
  } else {
    formError.value = res.error.message
  }
}

onMounted(async () => {
  if (!contentType.value) {
    loading.value = false
    return
  }

  if (mode.value === 'edit' && routeId.value) {
    await loadItem(routeId.value)
  } else if (mode.value === 'singleton' && routeId.value) {
    await loadItem(routeId.value)
  } else {
    initForm()
  }

  loading.value = false
})

// Reload when navigating between create/edit within the same type (e.g. after create redirect).
watch(routeId, async (newId, oldId) => {
  if (newId === oldId) return
  loading.value = true
  slugUnlocked.value = false
  clearErrors()
  if (newId) {
    await loadItem(newId)
  } else {
    item.value = null
    initForm()
  }
  loading.value = false
})

// ── Save / publish / delete ───────────────────────────────────────────────────

async function doSave(publishedOverride?: boolean) {
  saving.value = true
  formError.value = ''

  const payload: Record<string, unknown> = { ...form.value }
  if (publishedOverride !== undefined) payload.published = publishedOverride

  let res:
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; error: { code: string; message: string } }

  if (mode.value === 'create') {
    res = await api.post<Record<string, unknown>>(`/content/${type.value}`, payload)
  } else if (mode.value === 'singleton') {
    res = await api.put<Record<string, unknown>>(`/content/${type.value}`, payload)
  } else {
    res = await api.patch<Record<string, unknown>>(
      `/content/${type.value}/${routeId.value!}`,
      payload
    )
  }

  saving.value = false

  if (!res.ok) {
    const raw = res.error as { code: string; message: string; details?: Array<{ field: string; message: string }> }
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
  isPublished.value = res.data.published === true
  originalSlug.value = String(res.data.slug ?? '')
  slugUnlocked.value = false
  contentStore.invalidate(type.value)
  notify.success('Saved.')

  if (mode.value === 'create') {
    void router.replace({
      name: 'content-edit',
      params: { type: type.value, id: String(res.data.id) },
    })
  }
}

function saveDraft() {
  const valid = validate(allFields.value, form.value)
  if (!valid) return
  if (slugChanged.value) {
    pendingAction.value = () => doSave()
    showSlugConfirm.value = true
    return
  }
  void doSave()
}

function publish() {
  const valid = validate(allFields.value, form.value, true)
  if (!valid) return
  if (slugChanged.value) {
    pendingAction.value = () => doSave(true)
    showSlugConfirm.value = true
    return
  }
  void doSave(true)
}

function unpublish() {
  void doSave(false)
}

function confirmSlugChange() {
  showSlugConfirm.value = false
  if (pendingAction.value) {
    void pendingAction.value()
    pendingAction.value = null
  }
}

function cancelSlugChange() {
  showSlugConfirm.value = false
  pendingAction.value = null
}

async function doDelete() {
  showDeleteConfirm.value = false
  saving.value = true
  const res = await api.del(`/content/${type.value}/${routeId.value!}`)
  saving.value = false

  if (!res.ok) {
    formError.value = (res as { ok: false; error: { message: string } }).error.message
    return
  }

  contentStore.invalidate(type.value)
  void router.push({ name: 'content-list', params: { type: type.value } })
}

// ── Page title helper ─────────────────────────────────────────────────────────

const pageTitle = computed(() => {
  if (mode.value === 'create') return `New ${contentType.value?.label ?? ''}`
  if (mode.value === 'singleton') return contentType.value?.label ?? ''
  const titleField = allFields.value.find(f => f.field_type === 'text/plain')
  const title = titleField ? String(item.value?.[titleField.name] ?? '') : ''
  return title || (contentType.value?.label ?? '')
})
</script>

<template>
  <!-- Full-page loading -->
  <div v-if="loading" class="flex items-center justify-center py-20">
    <span
      class="inline-block h-6 w-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"
      aria-hidden="true"
    />
  </div>

  <div v-else-if="!contentType" class="py-12 text-center text-sm text-gray-500">
    Content type not found.
  </div>

  <div v-else>
    <!-- Page header -->
    <div class="mb-[22px] flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="mb-1.5 text-[11px] font-bold uppercase tracking-[.06em] text-faint">
          {{ contentType.label }}
        </p>
        <h1 class="text-[25px] font-bold tracking-tight text-ink">{{ pageTitle }}</h1>
      </div>

      <!-- Action bar -->
      <div class="flex shrink-0 flex-wrap items-center gap-[9px]">
        <button
          v-if="can('content:delete') && mode === 'edit'"
          type="button"
          :disabled="saving"
          class="inline-flex items-center gap-1.5 rounded-[10px] border border-[#F3D2D7] bg-white px-[15px] py-2.5 text-[13px] font-semibold text-[#E1495B] transition-colors hover:bg-[#FDF2F4] disabled:cursor-not-allowed disabled:opacity-50"
          @click="showDeleteConfirm = true"
        >
          Delete
        </button>

        <template v-if="can('content:edit')">
          <button
            v-if="isPublished"
            type="button"
            :disabled="saving"
            class="rounded-[10px] border border-[#E4E3EE] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#3D3D52] transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            @click="unpublish"
          >
            Unpublish
          </button>
          <button
            v-else
            type="button"
            :disabled="saving"
            class="rounded-[10px] border border-[#E4E3EE] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#3D3D52] transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
            @click="publish"
          >
            Publish
          </button>

          <button
            type="button"
            :disabled="saving"
            class="inline-flex items-center gap-1.5 rounded-[10px] bg-indigo-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_3px_10px_rgba(91,87,232,0.3)] transition-all hover:bg-indigo-700 hover:shadow-[0_6px_18px_rgba(91,87,232,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
            @click="saveDraft"
          >
            {{ saving ? 'Saving…' : 'Save draft' }}
          </button>
        </template>
      </div>
    </div>

    <!-- Slug field (hidden for singletons) -->
    <div v-if="!isSingleton" class="mb-[18px] rounded-2xl border border-card-border bg-white p-5 shadow-[0_1px_2px_rgba(24,24,48,0.04),0_8px_22px_rgba(24,24,48,0.04)]">
      <label for="slug-field" class="block text-[13px] font-semibold text-[#3D3D52]">
        Slug
        <span class="ml-0.5 text-red-500" aria-hidden="true">*</span>
      </label>

      <div class="mt-2 flex flex-wrap items-center gap-[10px]">
        <input
          id="slug-field"
          v-model="form.slug"
          type="text"
          :disabled="saving || (isPublished && !slugUnlocked)"
          :class="[
            'block min-w-[180px] flex-1 rounded-[10px] border px-[13px] py-[11px] font-mono text-sm focus:outline-none focus:ring-2',
            errors.slug
              ? 'border-red-300 focus:border-red-400 focus:ring-red-200'
              : 'border-[#E4E3EE] bg-surface focus:border-indigo-400 focus:ring-indigo-200',
            (saving || (isPublished && !slugUnlocked)) &&
              'cursor-not-allowed bg-gray-100 opacity-70',
          ]"
          placeholder="url-slug"
        />
        <button
          v-if="isPublished && !slugUnlocked"
          type="button"
          class="shrink-0 rounded-[10px] border border-[#E4E3EE] bg-white px-4 py-2.5 text-sm font-semibold text-[#3D3D52] transition-colors hover:bg-surface"
          @click="slugUnlocked = true"
        >
          Edit slug
        </button>
      </div>

      <p v-if="isPublished" class="mt-[9px] text-[12.5px] text-[#D9913C]">
        Changing this slug will break existing links.
      </p>
      <p v-if="errors.slug" class="mt-1 text-sm text-red-600" role="alert">
        {{ errors.slug }}
      </p>
    </div>

    <!-- Tab navigation (only when 2+ tabs) -->
    <div v-if="tabs.length > 1" ref="tabBarRef" class="relative mb-[22px] flex gap-0 overflow-x-auto border-b border-card-border">
      <button
        v-for="(tab, i) in tabs"
        :key="tab.name"
        :data-tab="tab.name"
        type="button"
        :class="[
          'mr-6 whitespace-nowrap bg-none px-0.5 py-[11px] text-sm transition-colors',
          activeTabIndex === i ? 'font-semibold text-indigo-600' : 'font-medium text-faint hover:text-[#8A8A9E]',
        ]"
        @click="activeTabIndex = i"
      >
        {{ tab.label }}
      </button>
      <div
        class="absolute -bottom-px h-0.5 rounded-full bg-indigo-600 transition-[left,width] duration-300"
        :style="{ left: `${tabIndLeft}px`, width: `${tabIndWidth}px` }"
      />
    </div>

    <!-- Fields -->
    <div class="space-y-5">
      <component
        :is="componentFor(field)"
        v-for="field in activeTabFields"
        :key="field.name"
        :field="field"
        :model-value="form[field.name]"
        :error="errors[field.name]"
        :disabled="saving"
        v-bind="fieldExtraProps(field)"
        @update:model-value="updateField(field.name, $event)"
      />
    </div>

    <!-- Form-level error -->
    <p v-if="formError" class="mt-4 text-sm text-red-600" role="alert">
      {{ formError }}
    </p>

    <!-- Dialogs -->
    <ConfirmDialog
      v-if="showSlugConfirm"
      message="This item is published. Changing its slug will break existing links. Continue?"
      :on-confirm="confirmSlugChange"
      :on-cancel="cancelSlugChange"
    />
    <ConfirmDialog
      v-if="showDeleteConfirm"
      message="Are you sure you want to delete this item? This action cannot be undone."
      :on-confirm="doDelete"
      :on-cancel="() => (showDeleteConfirm = false)"
    />
  </div>
</template>
