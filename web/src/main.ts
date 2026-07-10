import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import './styles/app.css'
import App from './App.vue'
import router from './router'
import { ignoreResizeObserverNoise } from './shared/utils/browserErrors'

ignoreResizeObserverNoise()

const app = createApp(App)

app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue error]', info, err)
}

app.use(createPinia()).use(Antd).use(router).mount('#app')
