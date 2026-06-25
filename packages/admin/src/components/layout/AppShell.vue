<script setup lang="ts">
import { useUiStore } from '../../stores/ui'
import Sidebar from './Sidebar.vue'
import Topbar from './Topbar.vue'
import Footer from './Footer.vue'
import ToastContainer from '../shared/ToastContainer.vue'

const uiStore = useUiStore()
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-surface">
    <Sidebar />

    <!-- Mobile drawer backdrop -->
    <div
      v-if="uiStore.isMobile && uiStore.mobileNavOpen"
      class="fixed inset-0 z-40 bg-[rgba(20,20,40,0.4)] backdrop-blur-[2px]"
      @click="uiStore.closeMobileNav()"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <Topbar />
      <main class="flex-1 overflow-y-auto p-6">
        <router-view />
        <Footer />
      </main>
    </div>

    <!-- Toast stack rendered outside the layout flow so it always overlays -->
    <ToastContainer />
  </div>
</template>
