import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/app/App.vue'
import router from '@/router'
import { useSessionStore } from '@/features/auth/stores/session'
import { setUnauthorizedHandler } from '@/shared/api/http'
import '@/styles/index.css'

const app = createApp(App)
const pinia = createPinia()

setUnauthorizedHandler(() => {
  useSessionStore(pinia).invalidate()
  if (router.currentRoute.value.path !== '/login') {
    void router.replace('/login')
  }
})

app.config.errorHandler = (err, _instance, info) => {
  if (import.meta.env.DEV) console.error('[Vue error]', info, err)
}

app.use(pinia)
app.use(router)
app.mount('#app')
