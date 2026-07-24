# Architecture

见 [FOUNDATION.md](./FOUNDATION.md)（权威）。

```text
Fastify plugins (src/plugins)  →  HTTP shell
app-context                    →  wire services on ctx
modules/*                      →  product features
platform/job+events            →  bulk jobs + cache side-effects
```

扩展：modules + app-context 接线 + compose 一行。  
**插件 ≠ 模块。** 插件只在 `src/plugins`。
