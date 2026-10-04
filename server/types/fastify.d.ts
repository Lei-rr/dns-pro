/** 路由级配置扩展 */

declare module 'fastify' {
  interface FastifyContextConfig {
    /** 允许在仍使用默认账号密码时访问（仅改密码接口） */
    allowDefaultCredential?: boolean
  }
}

export {}
