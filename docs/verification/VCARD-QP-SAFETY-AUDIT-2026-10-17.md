# VCF QP 与卡片边界安全审查（2026-10-17）

## 范围

本轮针对 Issue #35 的代理审查报告，复核四类风险：QP 属性头折行、普通值误判为 QP、非法 QP 编码，以及相邻卡片边界被软折行吞掉。审查只使用虚构值和 `src/domain/vcard.ts` 纯函数，不读取或写入思源工作区，也没有小米原始或脱敏 VCF 样本。

## 结论

- QP 判断现在只读取属性头冒号前的 `ENCODING=QP` 或 `ENCODING=QUOTED-PRINTABLE` 参数；普通值中出现 `QUOTED-PRINTABLE=` 不会触发合并。
- RFC 空格/制表符折行先展开，QP 无空白软折行只在属性头确认且下一行不是空行、卡片标记或属性行时合并。属性头自身折行（例如 `ENCODING=` 后换行）覆盖回归。
- QP 值中的每个 `=` 必须后跟两个十六进制字符。严格导入对半字节、非法等号和未完成软行拒绝整批；容错入口跳过损坏属性，不把它当作有效字段。
- 带前导空格的 `BEGIN:VCARD`/`END:VCARD` 保留为卡片标记，不能被上一条 QP 值吞掉。严格入口报告结构错误，容错入口仍可继续读取后继有效卡片。

## 证据

- `node --test tests/vcard.test.ts tests/vcard-service.test.ts`：30/30 通过。
- `node scripts/spike/vcard-compat-research.mjs`：17/17 合成场景通过（13 个基线、3 个候选缺口、1 个 UTF-16 传输边界）。
- `pnpm check`：0 errors / 0 warnings。

新增回归位于 `tests/vcard.test.ts`，修复位于 `src/domain/vcard.ts` 的物理行展开阶段。该修复没有扩大对损坏 QP 的静默容错，也没有修改联系人存储或导入契约。

## 仍未确认的边界

没有保留首卡属性名、参数、折行和空值形态的小米脱敏样本，无法把上述合成覆盖归因到 Issue #35 的真实根因，也不能据此关闭 Issue。下一步仍需用户提供脱敏首卡（可替换姓名、电话、邮箱等具体值，但保留属性结构），或在真实导入中复现并记录卡片序号与固定错误类别。
