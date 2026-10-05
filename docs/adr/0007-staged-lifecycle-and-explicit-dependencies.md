# ADR-0007：阶段化生命周期与显式依赖注入

- 状态：Accepted（实现进行中，尚未落地）
- 日期：2026-10-04
- 依据：`dns-pro-target-architecture.md` §3 D7
- 相关代码（现状）：`server/main.ts`、`server/app/context.ts`、`server/app/plugins/app-context.ts`

## 背景

启动顺序与依赖获取目前是隐式的：

- 模块级全局注入：`main.ts:14-17` 依次调用 `setDataRoot` / `setDefaultHttpTimeout`，`JsonStore` 与 HTTP 客户端从模块级变量读取配置（`core/store/data-root.ts`、`core/http/base-http.client.ts`）。
- 顺序靠注释约定：`app/context.ts` 中"迁移 → 凭据密钥 → 初始凭据 → 平台 → 模块 → 用例"是函数体顺序，`startAppContext` 里"清理完成后再恢复任务"是注释而非类型或断言约束。
- 依赖靠魔法取用：`app-context.ts` 把整个 `AppContext` 装饰到 Fastify 实例上，handler 通过 `request.server.ctx` 取任意依赖，编译期无法知道某 handler 实际需要什么。

## 决策

1. **显式阶段列表**：启动改为有序阶段数组 `[initConfig, initStore, runMigrations, initKernel, initDomains, initWorkflows, recoverJobs, ready]`，逐阶段 fail-fast；顺序是代码（数组）而不是注释。
2. **消除模块级可变全局**：`dataRoot`、HTTP 超时等改为构造参数传入；`JsonStore`、HTTP 客户端不再从模块级 setter 读取。
3. **handler 显式取依赖**：经显式工厂（或闭包）获得所需依赖，替代 `request.server.ctx` 的全量上下文抓取。
4. 组装层（`app/`）只做组合：允许它知道全部实现，禁止它承载业务判断。

## 后果

正面：

- 启动顺序可读、可测、可失败定位：哪个阶段失败一目了然，不会出现"注释说先清理后恢复，实际反过来"的隐性 bug。
- 无隐藏全局状态，测试可以并行构造多个实例（当前必须靠 `setDataRoot` 全局切换 + 手工清理）。
- handler 依赖显式化后，改一个 handler 的依赖不会牵动全局上下文。

负面：

- 装配代码会变长：所有构造顺序与依赖关系显式写出，`app/` 的阅读量上升。
- 迁移期两套注入方式并存（全局 setter 与构造注入），必须一次性删掉旧路径，否则会形成长期并行的两套架构。
- 显式阶段列表是新的约定点，新增阶段需要同时改列表与文档，靠架构守卫与评审保证不绕过。

## 替代方案

- **保留全局 setter + 注释顺序**：否决。顺序错误只能在运行时暴露，且全局状态使测试与并行构造困难。
- **引入 DI 容器 / 装饰器框架**：否决。与复杂度预算冲突，且框架本身会成为新的隐性约定来源。
- **让 handler 直接 import 单例**：否决。等于把全局状态从 setter 换成 import 副作用，问题不变。

## 验证计划

- 单元：阶段数组在任一阶段抛错时后续阶段不执行（fail-fast）。
- 架构守卫：禁止重新引入模块级可变全局与 `request.server.ctx` 抓取（`npm run arch:final`）。
- 回归：`npm run probe:default-config`、`probe:platform`、`probe:api` 覆盖启动与配置解析路径。
