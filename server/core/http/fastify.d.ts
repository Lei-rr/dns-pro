/** 路由级配置扩展 */

declare module 'fastify' {
  interface FastifyContextConfig {
    /** 允许在仍使用默认账号密码时访问（仅改密码接口） */
    allowDefaultCredential?: boolean
  }

  interface FastifyRequest {
    /** 已鉴权用户名：由 authRequired 钩子写入，供审计等只读场景取值（避免 core 层回查 modules） */
    authActor?: string
  }
}

export {}
