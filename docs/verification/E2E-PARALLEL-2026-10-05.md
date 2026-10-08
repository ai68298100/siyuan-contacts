# 多插件并行 E2E 验证

## 目标

验证多个作业可在后台同时运行，并且不会共享端口、思源工作区、浏览器 profile、证据文件或清理范围。

## 实际结果

命令：

```text
node scripts/e2e/parallel-runner.mjs --config scripts/e2e/parallel.example.json
```

结果：`3/3`。

| 作业 | 结果 | 隔离内容 |
|---|---:|---|
| `ui-desktop` | 通过，315/315 | Vite 回环端口、独立 Chromium profile、独立日志目录 |
| `ui-mobile` | 通过，316/316 | 独立 Vite 回环端口、独立 Chromium profile、独立日志目录 |
| `services-real-isolated` | 通过，9/9 | 独立 SiYuan v3.8.6 内核端口、UUID 工作区、独立服务证据 |

本次编排 run id：`9bc0d2aa-bc2f-4002-9cd9-edb6eea4795a`。作业失败不会提前停止其他作业；Windows 下由编排器启动 `cmd.exe`，避免 `pnpm.cmd` 直接 spawn 的兼容问题。结束时只清理编排器自己创建并持有的子进程树；日常思源进程不在清理范围。

真实服务作业中的 browser-desktop 仍因隔离宿主认证返回 `LIMITED`，不将其计为真实用户库或真机完成。Android 真机仍需 `adb` 和实际设备，原生图面板仍由 Host Queue 验收。
