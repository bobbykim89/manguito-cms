<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useUiStore } from '../stores/ui'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const uiStore = useUiStore()

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
  <div class="flex min-h-screen bg-surface">
    <!-- Brand panel — visible on large screens -->
    <div
      class="hidden lg:flex lg:w-80 lg:shrink-0 lg:flex-col lg:items-start lg:justify-between bg-gradient-to-br from-[#1C1C30] to-[#121220] px-10 py-12 text-white"
    >
      <div>
        <!-- Logo mark -->
        <div class="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] bg-gradient-to-br from-[#6D5EF0] to-indigo-600 shadow-[0_6px_18px_rgba(91,87,232,0.5)]">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" aria-hidden="true">
            <path d="M4 7h16" /><path d="M4 12h10" /><path d="M4 17h13" />
          </svg>
        </div>
        <h1 class="mt-8 text-[28px] font-bold leading-tight tracking-tight">{{ uiStore.cmsName }}</h1>
        <p class="mt-3.5 max-w-[300px] text-[15px] leading-relaxed text-white/60">
          Schema-driven headless CMS — manage your content with confidence.
        </p>
      </div>
      <p class="text-xs text-white/40">Self-hosted &amp; open source</p>
    </div>

    <!-- Form area -->
    <div class="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <!-- Mobile-only brand -->
      <div class="mb-8 flex flex-col items-center lg:hidden">
        <div class="flex h-10 w-10 items-center justify-center rounded-[11px] bg-gradient-to-br from-[#6D5EF0] to-indigo-600 shadow-[0_4px_12px_rgba(91,87,232,0.36)]">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 10h16M4 14h10M4 18h6" />
          </svg>
        </div>
        <h1 class="mt-4 text-lg font-bold text-ink">{{ uiStore.cmsName }}</h1>
      </div>

      <!-- Card -->
      <div class="w-full max-w-sm rounded-[20px] border border-card-border bg-white px-8 py-10 shadow-[0_10px_40px_rgba(24,24,48,0.1)]">
        <h2 class="mb-1 text-[21px] font-bold tracking-tight text-ink">Sign in</h2>
        <p class="mb-6 text-sm text-muted">Enter your credentials to continue.</p>

        <form class="space-y-[18px]" novalidate @submit.prevent="onSubmit">
          <!-- Email -->
          <div>
            <label for="email" class="block text-[13px] font-semibold text-[#3D3D52]">Email</label>
            <input
              id="email"
              v-model="email"
              type="email"
              required
              autocomplete="email"
              :disabled="submitting"
              class="mt-[7px] block w-full rounded-[11px] border border-[#E4E3EE] bg-[#FBFBFD] px-3.5 py-3 text-sm text-ink placeholder-faint transition-colors focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <!-- Password -->
          <div>
            <label for="password" class="block text-[13px] font-semibold text-[#3D3D52]">Password</label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              autocomplete="current-password"
              :disabled="submitting"
              class="mt-[7px] block w-full rounded-[11px] border border-[#E4E3EE] bg-[#FBFBFD] px-3.5 py-3 text-sm text-ink placeholder-faint transition-colors focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <!-- Inline error -->
          <p v-if="formError" class="rounded-[10px] bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
            {{ formError }}
          </p>

          <!-- Submit -->
          <button
            type="submit"
            :disabled="submitDisabled"
            class="w-full rounded-[11px] bg-indigo-600 px-4 py-[13px] text-sm font-semibold text-white shadow-[0_4px_14px_rgba(91,87,232,0.34)] transition-colors hover:bg-indigo-700 hover:shadow-[0_8px_22px_rgba(91,87,232,0.44)] focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ submitting ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
