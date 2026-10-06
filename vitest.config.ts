import { defineConfig } from 'vitest/config'

/**
 * 三环境测试入口（现代 projects 写法；vitest.workspace 字段已废弃，不再使用）：
 * - scripts：Node 环境，跑架构守卫（scripts/check-architecture.mjs）的规则测试；
 * - server：Node 环境，直接跑 server/ 下的 ESM 源码（相对导入带 .js 后缀）；
 * - web：happy-dom 环境，extends web/vite.config.ts 复用现成的 Vue SFC 编译与 @ 别名，
 *   避免在测试配置里再抄一份 vite 插件/别名（也就不会出现"根配置依赖 web 依赖"的错位）。
 */
export default defineConfig({
  test: {
    /** 整轮测试结束后清理本轮新建的临时数据目录（见 vitest.global-setup.ts） */
    globalSetup: ['./vitest.global-setup.ts'],
    projects: [
      {
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.{test,spec}.ts'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/*.{test,spec}.ts'],
        },
      },
      {
        extends: './web/vite.config.ts',
        test: {
          name: 'web',
          environment: 'happy-dom',
          include: ['web/src/**/*.{test,spec}.ts'],
        },
      },
    ],
  },
})
