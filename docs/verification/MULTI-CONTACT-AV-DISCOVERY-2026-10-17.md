# 原生方法 AV 无锚点冷发现研究（2026-10-17）

对应`AG-RF-004-A2`、Issue #51/#54。A1已证明已知AV十方法可分页回读、坏身份拒绝、删行/实验缓存删除/重启，但它一直保有锚点。本报告冻结并执行了研究锚点配置全部丢失后的候选发现；不采纳生产事实源、恢复格式或删除协议。

## 范围与拒绝规则

只枚举当前SQL索引可见的原生`type='av'`载体，不按标题、笔记本名、marker、方法特征或已知ID预筛选。关闭/加密/未加载内容、未索引载体、孤立磁盘AV、未知类型载体、一般嵌套闭包和历史曾存在的数据均不在全集声明中。方法列全部被改名后可能只剩无关schema，零候选不能证明没有历史方法，更不能授权新库/清空。

首页固定`SELECT id, root_id, parent_id, box, type, markdown FROM blocks WHERE type='av' ORDER BY id LIMIT 3`；后页只增加合法`AND id > '<lastProcessedID>'`。默认pageSize2、最大8页，第三条只作lookahead，游标取最后已处理行；验证原始数组/字段、合法ID、严格递增、唯一、id>cursor、长度和预算，耗尽后另验空页。低预算场景pageSize1/maxPages1。基础传输/字段/keyset/原生markdown分别已有证据，但该全库组合查询是A2首次隔离形状实证，必须保存完整原始响应。

载体必须是直接文档子块、根文档独立SQL可达且box相同；SQL markdown严格解析唯一`<div data-type="NodeAttributeView" data-av-id="合法ID" data-av-type="table"></div>`及属性，不取第一个正则匹配。重复属性/多AV声明/未知结构/非法ID/非直接载体保持unknown。不新增未实证的getBlockDOM/getBlockAttrs路由。

schema按8个固定名称methodId/ownerDocId/sourceKey/type/label/value/primary/order逐一唯一匹配text列，且宿主block主键唯一；部分方法列、同名多列、类型变化或坏列形状为unknown，不静默当无关AV。完全无方法特征的AV保留unrelated记录；但同一AV已有matching载体时，另一载体若unrelated/unknown也必须与该AV聚合并使候选unknown，不能以“无关”排除坏载体。空matching AV也是schema候选；不同AV即使schema/内容/methodID相同也不合并。同AV多个载体保留全部来源，分别回读并核对当前方法集合。

render仅`query:""`、`createIfNotExist:false`、正数page/pageSize2，最多8页+额外空页+pageSize500小样本对照。核对返回AV/view ID、table类型、稳定列/rowCount/唯一rowID/逐页进度、无实质filter/group/context/mirror。具体只接受filters为空数组或A1原始响应的精确空占位`[{column:"",operator:"",value:null,combination:"and"}]`、sorts为空数组、group/contextFilter为null、groupHidden为0、contextFilterFields为空数组、isMirror=false；其他shape不猜测为无过滤。8方法值全部严格解析，text cell的blockID必须等于当前row.id；类型只限A1的phone/email/wechat/url。owner引用只从本次原生值提取并独立SQL核实文档可达，不以可达文档冒充已登记人物/外键。沿用研究hash身份规则和字段边界，但不采纳生产方法身份。

小页/大页精确比较rowID及8方法text字段；宿主其他cell只作基础形状校验并保留raw，`fullHostCellCrossReadEqualityVerified=false`。A1空Select归一依赖磁盘无持久值证明，A2禁止读该文件，不能移植该允许列表，也不由父进程补入证明。空/重复有效身份、旧hash改owner、主值冲突、未知行或部分读取拒绝整个候选语义集合，不以有效子集冒充完整。

候选扫描完整、当前AV方法读取完整、归属与历史全集分别报告。一个可读候选只为`unique_unowned`，多个为`ambiguous`；零候选只为`not_found_in_observed_scope`；任何未知/截断撤回唯一判断。ownership/historical scope/write/rebind/newLibrary/tombstone始终false，外层methods为空，不保存恢复配置、不自动选第一份或创建库。

## 独立进程与配置删除

新UUID临时目录、随机回环端口、逐HTTP请求核实marker/真实路径/持有Kernel PID；只结束本轮持有进程，失败保留现场，不递归删除目录。读取守卫与信息边界不是OS隔离。

独立producer进程负责夹具/研究配置，HTTP由父broker代发。producer把完整oracle和manifest交给父审计侧后退出；父核实退出、每个本轮精确配置路径/内容/摘要及无链接，再逐文件unlink。研究配置保存锚点/列/已知身份，不是方法事实；全部值留在原生AV。先前配置必须都不存在才启动下一次cold reader。

独立cold reader入口不import旧spike/fixture/oracle/FS/HTTP/child_process，启动首包仅协议版本与数值预算；env显式白名单、execArgv清空，argv/env/IPC首包不得带实验workspace/报告路径、runUUID、notebook/doc/AV/key/item/method ID、列映射、预期条数、token或creator-only canary。运行时/源文件路径不是实验数据路径，单列记录。

reader经IPC发请求，单pending、seq递增，限制请求数/JSON字节/超时。父broker独立拒绝已耗尽的maxRequests，不只依赖reader自限；小页page上限为avMaxPages+1（含末尾空页核查），500行对照只允许page1。父broker仅接受精确冻结SQL模板及render参数，来源集合每个reader从空开始，只由该reader收到的原始响应登记ID及provenance；render必须是原生carrier→AV配对，owner/root/cursor必须已在本次原始响应出现。父只添加鉴权/安全连接，原样发送body、原样返回成功/失败信封，不按oracle筛选/补字段/修正坏ID。错误只传固定类别，不传父路径/token/原始异常。oracle只在reader退出后作独立对照，不作为读取输入。

## 冻结场景与验收

1. 空新工作区先独立冷读，只证明当前范围未找到，零新建。
2. producer1创建两虚构人物、十方法AV及无关AV，任意载体标题；保存研究配置后退出，父精确删除配置，fresh reader独立发现一个可读但归属未证候选。
3. 同场景两个fresh reader分别低预算和一次broker在render派发前拒绝，返回truncated/unknown。后者是受控IPC传输故障注入，不是内核真实坏响应；不得自动重试。
4. producer2新增同内容第二AV（相同方法ID也不得跨AV去重）和同schema空AV，退出/删除其配置，fresh reader列出三候选并保持ambiguous。
5. producer3新增缺一方法列的AV，退出/删除其配置，fresh reader保留原候选及unknown映射，不能排除坏库后宣称唯一。

纯反例覆盖载体重复/非法属性、分页乱序/重复/游标/预算/末页、schema缺/重/改type、空候选、多载体/多AV歧义、过滤/镜像、坏身份/归属、owner不可达、视图/列/总数漂移、IPC模板/seq/来源/字节/超时、输入不变及所有写权限关闭。默认/import/--dry-run零文件写删/HTTP/端口绑定/进程启动；真实运行显式`LVCT_RUN_AV_COLD=1`。

## 当前状态

已完成隔离研究（`done_isolated`），生产契约、功能、版本和Issue状态不变。独立复核补齐父broker的请求数硬预算、分页上界及实际初始provenance断言；`initialIPCOnly`取实际初始状态，六个reader均记录`initialProvenanceEmpty=true`与`previousResearchConfigsAbsent=true`。`node --check`、默认 dry-run 和显式 `LVCT_RUN_AV_COLD=1` 均通过；冷 reader 与 broker 纯检查分别 33/33、17/17。

修复后最终隔离轮使用 Kernel `3.8.8-alpha.2`、runUUID `934f6213-fb65-4576-96e1-50bfb0173f1d`、随机回环端口 `3596`，执行 151 次原始 HTTP 请求、47 次仅虚构夹具修改；阶段结果为 `empty=not_found_in_observed_scope`、`unique=unique_unowned`（独立 oracle 1/1）、低预算 `truncated`、受控 broker 拒绝 `unknown`、同内容多 AV `ambiguous`（3/3）、缺列 AV `unknown`（保留 3 个已读候选并记录 1 个 partial unknown）。同AV多carrier的配对保存与请求许可已有纯broker反例覆盖；本轮真实夹具每AV只有一个carrier，不能当作多carrier宿主回读证据。配置文件逐字节核实后删除，reader 不接收锚点或 oracle；内核 PID 已退出、端口已释放、生产变更为 0。完整原始响应和阶段候选见 [`contact-methods-av-cold-results.json`](../../scripts/spike/contact-methods-av-cold-results.json)。

本轮 `pnpm check` 为0 errors / 0 warnings，`pnpm test`为656/656。旧UUID轮的完整证据仍留在各自虚构临时工作区；本文件与canonical results只引用修复后的最终轮。

独立只读复核按当前broker重放六阶段共91个实际读取请求，requests/bytes/provenance一致；受控拒绝未计入已派发请求。三个oracle均按producer原始addKey/append参数独立重建并匹配方法语义，500行对照的原生rowID与方法字段一致。三个配置当前不存在，canonical与临时工作区保留证据逐字节一致，token未进入证据；端口3596再次核实无监听。此复核未启动HTTP或Kernel，不扩充真实宿主范围。

本轮只比较方法字段和候选 AV 身份；候选 `itemID`/8 方法值的小页与 500 行对照在 reader 内部严格比较，producer oracle 不持久化行 ID。孤立磁盘、未索引/关闭内容、历史曾存在的 AV、真实卸载后的用户工作区、原生编辑/复制、并发和恢复仍未验证，不能关闭 #51/#54 或把唯一候选自动重绑。
