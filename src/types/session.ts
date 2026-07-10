declare module '@fastify/secure-session' {
  interface SessionData {
    'auth.signed_in'?: boolean
    'auth.username'?: string | null
  }
}

export {}
