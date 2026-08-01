import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/app/App.vue'
import router from '@/app/router'
import { useSessionStore } from '@/features/auth'
import { clearProvidersCache } from '@/features/providers'
import { setUnauthorizedHandler } from '@/shared/api/http'
import { watch } from 'vue'
import '@/app/styles/index.css'

const app = createApp(App)
const pinia = createPinia()
const sessionStore = useSessionStore(pinia)

watch(
  () => sessionStore.revision,
  () => clearProvidersCache()
)

setUnauthorizedHandler(() => {
  sessionStore.invalidate()
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
