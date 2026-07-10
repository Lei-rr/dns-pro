import type { App } from 'vue'
import Antd, { message, Modal, notification } from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'

message.config({
  top: '80px',
  duration: 3,
  maxCount: 5,
})

notification.config({
  top: '80px',
  duration: 3,
})

export function installAntDesignVue(app: App) {
  app.use(Antd)
}

export { message, Modal as modal, notification }
