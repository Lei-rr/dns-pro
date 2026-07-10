export function providerPath(providerId: string) {
  return '/' + encodeURIComponent(providerId)
}

export function providerChildPath(providerId: string, childId: string) {
  return providerPath(providerId) + '/' + encodeURIComponent(childId)
}
