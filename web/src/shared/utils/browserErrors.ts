const resizeObserverMessages = [
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
]

let installed = false

export function ignoreResizeObserverNoise() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    if (resizeObserverMessages.includes(event.message)) {
      event.stopImmediatePropagation()
      event.preventDefault()
    }
  })
}
