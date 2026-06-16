<script setup lang="ts">
import { watch } from 'vue'
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
</script>

<template>
  <div>
    <span class="block text-sm font-medium text-gray-700">
      {{ field.label }}
      <span v-if="field.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span>
    </span>

    <div
      :class="[
        'mt-1 overflow-hidden rounded-md border shadow-sm',
        error ? 'border-red-300' : 'border-gray-300',
        disabled && 'opacity-60',
      ]"
    >
      <!-- Toolbar -->
      <div
        class="flex flex-wrap gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1.5"
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
      </div>

      <!-- Editor content — v-if narrows Editor | undefined → Editor for the prop -->
      <EditorContent
        v-if="editor"
        :editor="editor"
        :class="[
          'min-h-32 px-3 py-2 text-sm [&_.ProseMirror]:outline-none',
          '[&_.ProseMirror_h1]:text-xl [&_.ProseMirror_h1]:font-bold',
          '[&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-bold',
          '[&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold',
          '[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5',
          '[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5',
          disabled && 'cursor-not-allowed',
        ]"
      />
    </div>

    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
  </div>
</template>
