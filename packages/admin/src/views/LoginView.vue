<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const formError = ref('')
const retrySeconds = ref(0)

let countdown: ReturnType<typeof setInterval> | null = null

const submitDisabled = computed(() => submitting.value || retrySeconds.value > 0)

function updateRateLimitMessage() {
  formError.value = `Too many attempts. Try again in ${Math.ceil(retrySeconds.value / 60)} minutes.`
}

function startCountdown(seconds: number) {
  retrySeconds.value = seconds
  updateRateLimitMessage()
  if (countdown) clearInterval(countdown)
  countdown = setInterval(() => {
    retrySeconds.value -= 1
    if (retrySeconds.value <= 0) {
      clearInterval(countdown!)
      countdown = null
      retrySeconds.value = 0
      formError.value = ''
    } else {
      updateRateLimitMessage()
    }
  }, 1000)
}

onUnmounted(() => {
  if (countdown) clearInterval(countdown)
})

async function onSubmit() {
  if (submitDisabled.value) return
  submitting.value = true
  formError.value = ''

  let res: Response
  try {
    res = await fetch(`${__ADMIN_PREFIX__}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value }),
    })
  } catch {
    formError.value = 'Something went wrong. Please try again.'
    submitting.value = false
    return
  }

  const json = (await res.json()) as {
    ok: boolean
    data?: { id: string; email: string; role: string; must_change_password: boolean }
    error?: { code: string; message: string }
  }

  if (!json.ok) {
    const code = json.error?.code ?? ''
    if (code === 'INVALID_CREDENTIALS') {
      formError.value = 'Invalid email or password.'
    } else if (code === 'RATE_LIMITED') {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10)
      startCountdown(isNaN(retryAfter) ? 60 : retryAfter)
    } else {
      formError.value = 'Something went wrong. Please try again.'
    }
    submitting.value = false
    return
  }

  const user = json.data!
  authStore.setUser({
    id: user.id,
    email: user.email,
    role: user.role,
    mustChangePassword: user.must_change_password,
  })

  if (user.must_change_password) {
    void router.push(`${__ADMIN_PREFIX__}/change-password`)
  } else {
    const redirect = route.query.redirect
    void router.push(typeof redirect === 'string' ? redirect : `${__ADMIN_PREFIX__}/media`)
  }
}
</script>

<template>
  <!-- Standalone layout — no AppShell/sidebar chrome -->
  <div class="flex min-h-screen items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm">
      <h1 class="mb-8 text-center text-2xl font-bold text-gray-900">Sign in</h1>

      <form class="space-y-5" novalidate @submit.prevent="onSubmit">
        <!-- Email -->
        <div>
          <label for="email" class="block text-sm font-medium text-gray-700">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autocomplete="email"
            :disabled="submitting"
            class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60"
          />
        </div>

        <!-- Password -->
        <div>
          <label for="password" class="block text-sm font-medium text-gray-700">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            autocomplete="current-password"
            :disabled="submitting"
            class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60"
          />
        </div>

        <!-- Inline error -->
        <p v-if="formError" class="text-sm text-red-600" role="alert">
          {{ formError }}
        </p>

        <!-- Submit -->
        <button
          type="submit"
          :disabled="submitDisabled"
          class="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {{ submitting ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  </div>
</template>
