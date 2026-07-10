export function useLatestTask() {
  let token = 0

  function next() {
    token += 1
    return token
  }

  function cancel() {
    token += 1
  }

  function current() {
    return token
  }

  function isCurrent(value: number) {
    return value === token
  }

  return { next, cancel, current, isCurrent }
}
