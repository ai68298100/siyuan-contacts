# AG-P0-019 存储锁安全验证（2026-10-03）

原实现等待连续超时后以 `steal` 接管仍可能恢复的写者，已在真实浏览器两个独立同源上下文复现互动数据丢失。修复采用有限等待后报占用超时，保留原锁；任务为 `host_pending`，不是实际思源多窗口已完成。

## 修复前证据

使用 `scripts/e2e/ui/store-frame.html` 创建两个独立 iframe，各自加载真实 `data/storage` 和 `data/interactions` 模块，数据写隔离 localStorage。取锁等待缩短为每次 50ms，默认重排队一次；在第一上下文的保存已开始后暂停其实际写入，第二上下文调用同一互动存储键。

原实现的回归退出 1（110/111）。断言输出：

```json
{
  "waiting": "fulfilled",
  "writesBeforeRelease": 1,
  "heldBeforeRelease": true,
  "holder": "fulfilled",
  "refs": ["slow-holder"]
}
```

第二调用在旧保存恢复前已经写入一次并返回成功；释放旧保存后，最终仅剩旧互动，第二条 `waiting-writer` 消失。这证明等待超时不能证明持有者永不恢复。原日志：`C:\Users\sunku\AppData\Local\Temp\lvct-lock-before-20261003.log`（临时文件可能被系统清理，关键输入和结果已记录在本文件）。

## 修复与验收

`src/data/storage.ts` 不再使用 `steal`。默认每次等待 5 秒、重排队一次，仅本次取锁计时器触发且未获锁的等待可重排队；耗尽后返回含 key/timeoutMs/attempts 的 `StoreLockTimeoutError`，本次业务回调零执行。获锁立即清除取锁计时器；回调 AbortError、嵌套锁超时及平台拒绝原样上抛，不重新执行业务。

| 检查 | 实际断言 |
|---|---|
| 长暂停或仍挂起 | 第二上下文等待耗尽并拒绝、零保存；原锁仍 held，旧操作恢复后保留旧事实 |
| 详情页占用反馈 | 显示“此次操作尚未执行”及核实重试指引；备注保留、按钮恢复、没有“已记录” |
| 显式重试 | 原操作完成后点击记录；两条事实保留，备注随成功保存后清空 |
| 正常慢写 | 从实际浏览器 pending 队列确认第二上下文在等待；释放旧保存后两次调用都成功，保留两条互动 |
| 前置读取失败 | 两上下文分别注入读取失败；两次拒绝，零写入，原库不变 |
| 已保存但回读失败 | 第一调用报写入未收敛；随后第二上下文锁内读取保留第一条已保存事实，再追加新记录 |
| 已保存但返回取消 | 第一保存先落盘再抛 AbortError；原错误传递、业务只保存一次，另一上下文仍保留事实并继续追加 |
| 单元边界 | 同/不同键排队、失败释放、取锁超时零回调、宽限获取、零重排队、获锁停止计时、回调取消/嵌套失败不重放、平台 AbortError、同步拒绝清理计时器、非法配置拒绝、严格/容错读取 |

已有 `saveJsonVerified` 的两次不收敛检查未改变；写后回读失败不是未获得锁，不能据此自动重放整个读改写回调。真正挂起的原操作结束前，该键暂不可写；无 Web Locks 时仍只保证单上下文队列。

## 验证结果与复现

执行 `node --test tests/storage.test.ts`（13/13），以及 `pnpm check`（0 errors / 0 warnings）、`pnpm test`（252/252，0 skipped）、`pnpm test:ui`（112/112）、`pnpm test:ui:mobile`（113/113）和 `pnpm build`（通过）。UI 两个新增用例名称以“存储锁实际双上下文”开头，位于 `scripts/e2e/ui/smoke.js`。这些命令复用已有依赖，启动 loopback Vite 和独立浏览器目录，不连接用户内核。

日志位于 `C:\Users\sunku\AppData\Local\Temp\lvct-lock-{check,unit,desktop,mobile,build}-20261003.log`。最终桌面目录为 `lvct-ui-YQAXVX`，移动目录为 `lvct-ui-IvD36P`；进程退出、目录清理正常，无未处理异常。

持久化替身是 localStorage，不是思源文件。尚未验证真实思源保存、多窗口客户端的锁作用域、系统暂停恢复、移动系统返回；对应宿主门禁保留。未安装到日常库、未提交或发布，版本、CHANGELOG、README 和 PROGRESS 未改。
