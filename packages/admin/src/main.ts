import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'

const app = createApp(App)

// Pinia must be installed before the router because navigation guards
// call useAuthStore(), which requires an active Pinia instance.
app.use(createPinia())
app.use(router)

app.mount('#app')
