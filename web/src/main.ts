import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/app.css'
import App from './App.vue'
import router from './router'
import { useSessionStore } from './stores/session'
import { installAntDesignVue } from './shared/plugins/antDesignVue'
import { setUnauthorizedHandler } from './shared/utils/request'
import { ignoreResizeObserverNoise } from './shared/utils/browserErrors'

ignoreResizeObserverNoise()

const app = createApp(App)
const pinia = createPinia()

app.config.errorHandler = (err, _instance, info) => {
  if (import.meta.env.DEV) console.error('[Vue error]', info, err)
}

setUnauthorizedHandler(() => {
  useSessionStore(pinia).invalidate()
  if (router.currentRoute.value.path !== '/login') {
    void router.replace('/login')
  }
})

app.use(pinia)
installAntDesignVue(app)
app.use(router).mount('#app')
