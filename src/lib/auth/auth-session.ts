import type { FastifyRequest } from 'fastify'

const SIGNED_IN_KEY = 'auth.signed_in'
const USERNAME_KEY = 'auth.username'

export function isSignedIn(request: FastifyRequest): boolean {
  return request.session.get(SIGNED_IN_KEY) === true
}

export function signIn(request: FastifyRequest, username: string): void {
  request.session.set(SIGNED_IN_KEY, true)
  request.session.set(USERNAME_KEY, username)
}

export function signOut(request: FastifyRequest): void {
  request.session.set(SIGNED_IN_KEY, false)
  request.session.set(USERNAME_KEY, null)
}

export function getUsername(request: FastifyRequest): string | null {
  const username = request.session.get(USERNAME_KEY)
  return typeof username === 'string' && username !== '' ? username : null
}
