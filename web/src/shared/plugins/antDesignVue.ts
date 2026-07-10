import { message, Modal, notification } from 'ant-design-vue'

message.config({
  top: '80px',
  duration: 3,
  maxCount: 5,
})

notification.config({
  top: '80px',
  duration: 3,
})

export { message, Modal as modal, notification }
