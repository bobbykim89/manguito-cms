<script setup lang="ts">
import { ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import type { ParsedField } from '@bobbykim/manguito-cms-core'

const props = defineProps<{
  field: ParsedField
  modelValue: unknown
  error?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editor = useEditor({
  content: typeof props.modelValue === 'string' ? props.modelValue : '',
  editable: !props.disabled,
  extensions: [
    StarterKit,
    Link.configure({ openOnClick: false }),
  ],
  onUpdate: ({ editor: e }) => {
    emit('update:modelValue', e.getHTML())
  },
})

// Sync editor content when modelValue changes from outside (form reset / initial load).
watch(
  () => props.modelValue,
  (v) => {
    const html = typeof v === 'string' ? v : ''
    if (editor.value && editor.value.getHTML() !== html) {
      editor.value.commands.setContent(html, false)
    }
  }
)

// Sync editable state when disabled changes.
watch(
  () => props.disabled,
  (val) => {
    editor.value?.setEditable(!val)
  }
)

type Level = 1 | 2 | 3

function cmd(fn: () => void) {
  if (!props.disabled) fn()
}

function isActive(name: string, attrs?: Record<string, unknown>) {
  return editor.value?.isActive(name, attrs) ?? false
}

// ── Link popover ──────────────────────────────────────────────────────────────

const showLinkPanel = ref(false)
const linkUrl = ref('')
const linkTarget = ref<'_self' | '_blank'>('_self')
const linkClass = ref('')
const linkPanelRef = ref<HTMLElement | null>(null)

onClickOutside(linkPanelRef, () => closeLinkPanel())

function toggleLinkPanel() {
  if (showLinkPanel.value) {
    closeLinkPanel()
    return
  }
  const attrs = editor.value?.getAttributes('link') ?? {}
  linkUrl.value = typeof attrs['href'] === 'string' ? attrs['href'] : ''
  linkTarget.value = attrs['target'] === '_blank' ? '_blank' : '_self'
  linkClass.value = typeof attrs['class'] === 'string' ? attrs['class'] : ''
  showLinkPanel.value = true
}

function closeLinkPanel() {
  showLinkPanel.value = false
}

function applyLink() {
  const url = linkUrl.value.trim()
  if (!url) {
    editor.value?.chain().focus().extendMarkRange('link').unsetLink().run()
  } else {
    editor.value
      ?.chain()
      .focus()
      .extendMarkRange('link')
      .setLink({
        href: url,
        target: linkTarget.value,
        rel: linkTarget.value === '_blank' ? 'noopener noreferrer' : null,
        class: linkClass.value.trim() || null,
      })
      .run()
  }
  closeLinkPanel()
}

function removeLink() {
  editor.value?.chain().focus().extendMarkRange('link').unsetLink().run()
  closeLinkPanel()
}
</script>

<template>
  <div>
    <span class="block text-[13px] font-semibold text-[#3D3D52]">
      {{ field.label }}
      <span v-if="field.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span>
    </span>

    <div
      :class="[
        'mt-1 rounded-md border shadow-sm',
        error ? 'border-red-300' : 'border-gray-300',
        disabled && 'opacity-60',
      ]"
    >
      <!-- Toolbar — rounded-t (not overflow-hidden on the wrapper) so the link
           popover below isn't clipped by the editor's own rounded-corner box. -->
      <div
        class="flex flex-wrap gap-0.5 rounded-t-md border-b border-gray-200 bg-gray-50 px-2 py-1.5"
        :aria-label="`${field.label} formatting toolbar`"
      >
        <!-- Bold -->
        <button
          type="button"
          title="Bold"
          :class="['rounded px-2 py-1 text-xs font-bold', isActive('bold') ? 'bg-gray-200' : 'hover:bg-gray-200']"
          :disabled="disabled"
          @click="cmd(() => editor?.chain().focus().toggleBold().run())"
        >
          B
        </button>

        <!-- Italic -->
        <button
          type="button"
          title="Italic"
          :class="['rounded px-2 py-1 text-xs italic', isActive('italic') ? 'bg-gray-200' : 'hover:bg-gray-200']"
          :disabled="disabled"
          @click="cmd(() => editor?.chain().focus().toggleItalic().run())"
        >
          I
        </button>

        <span class="mx-1 text-gray-300" aria-hidden="true">|</span>

        <!-- H1 -->
        <button
          v-for="level in ([1, 2, 3] as Level[])"
          :key="level"
          type="button"
          :title="`Heading ${level}`"
          :class="[
            'rounded px-2 py-1 text-xs font-semibold',
            isActive('heading', { level }) ? 'bg-gray-200' : 'hover:bg-gray-200',
          ]"
          :disabled="disabled"
          @click="cmd(() => editor?.chain().focus().toggleHeading({ level }).run())"
        >
          H{{ level }}
        </button>

        <span class="mx-1 text-gray-300" aria-hidden="true">|</span>

        <!-- Bullet list -->
        <button
          type="button"
          title="Bullet list"
          :class="['rounded px-2 py-1 text-xs', isActive('bulletList') ? 'bg-gray-200' : 'hover:bg-gray-200']"
          :disabled="disabled"
          @click="cmd(() => editor?.chain().focus().toggleBulletList().run())"
        >
          • List
        </button>

        <!-- Ordered list -->
        <button
          type="button"
          title="Ordered list"
          :class="['rounded px-2 py-1 text-xs', isActive('orderedList') ? 'bg-gray-200' : 'hover:bg-gray-200']"
          :disabled="disabled"
          @click="cmd(() => editor?.chain().focus().toggleOrderedList().run())"
        >
          1. List
        </button>

        <span class="mx-1 text-gray-300" aria-hidden="true">|</span>

        <!-- Link -->
        <div ref="linkPanelRef" class="relative">
          <button
            type="button"
            title="Link"
            :class="['rounded px-2 py-1 text-xs', isActive('link') ? 'bg-gray-200' : 'hover:bg-gray-200']"
            :disabled="disabled"
            @click="cmd(toggleLinkPanel)"
          >
            Link
          </button>

          <div
            v-if="showLinkPanel"
            class="absolute left-0 top-full z-10 mt-1 w-64 rounded-md border border-gray-200 bg-white p-3 text-left shadow-lg"
          >
            <label class="block text-xs font-medium text-gray-700">URL</label>
            <input
              v-model="linkUrl"
              type="text"
              placeholder="https://example.com"
              class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />

            <label class="mt-2 block text-xs font-medium text-gray-700">Target</label>
            <select
              v-model="linkTarget"
              class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="_self">Same tab (_self)</option>
              <option value="_blank">New tab (_blank)</option>
            </select>

            <label class="mt-2 block text-xs font-medium text-gray-700">
              CSS class <span class="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              v-model="linkClass"
              type="text"
              placeholder="btn btn-primary"
              class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />

            <div class="mt-3 flex items-center justify-between gap-2">
              <button
                v-if="isActive('link')"
                type="button"
                class="text-xs font-medium text-red-600 hover:text-red-800"
                @click="removeLink"
              >
                Remove link
              </button>
              <div class="ml-auto flex gap-2">
                <button
                  type="button"
                  class="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                  @click="closeLinkPanel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                  @click="applyLink"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Editor content — v-if narrows Editor | undefined → Editor for the prop -->
      <EditorContent
        v-if="editor"
        :editor="editor"
        :class="[
          'rounded-b-md px-3 py-2 text-sm [&_.ProseMirror]:min-h-32 [&_.ProseMirror]:cursor-text [&_.ProseMirror]:outline-none',
          '[&_.ProseMirror_h1]:text-xl [&_.ProseMirror_h1]:font-bold',
          '[&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-bold',
          '[&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold',
          '[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5',
          '[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5',
          '[&_.ProseMirror_a]:text-indigo-600 [&_.ProseMirror_a]:underline',
          disabled && 'cursor-not-allowed [&_.ProseMirror]:cursor-not-allowed',
        ]"
      />
    </div>

    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
  </div>
</template>
