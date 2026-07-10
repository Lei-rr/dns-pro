declare module 'fastify' {
  interface Session {
    'auth.signed_in'?: boolean
    'auth.username'?: string | null
  }
}

export {}
