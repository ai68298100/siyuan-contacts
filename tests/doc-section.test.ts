import { test } from "node:test";
import assert from "node:assert/strict";
import {
    profileSectionMarkdown,
    interactionSectionMarkdown,
    followupsSectionMarkdown,
    exchangesSectionMarkdown,
    anniversariesSectionMarkdown,
    PROFILE_SECTION_ATTR,
    INTERACTIONS_SECTION_ATTR,
    RELATED_SECTION_ATTR,
    FOLLOWUPS_SECTION_ATTR,
    EXCHANGES_SECTION_ATTR,
    ANNIVERSARIES_SECTION_ATTR,
} from "../src/domain/doc-section.ts";
import type { ContactSummary } from "../src/domain/person.ts";
import type { InteractionEvent } from "../src/domain/interactions.ts";
import type { FollowUpItem } from "../src/domain/followups.ts";
import type { ExchangeRecord } from "../src/domain/exchanges.ts";
import type { AnniversaryItem } from "../src/domain/anniversaries.ts";

test("doc-section 属性标记常量契约稳定", () => {
    assert.equal(PROFILE_SECTION_ATTR, "custom-lvct-profile");
    assert.equal(INTERACTIONS_SECTION_ATTR, "custom-lvct-interactions");
    assert.equal(RELATED_SECTION_ATTR, "custom-lvct-related");
    assert.equal(FOLLOWUPS_SECTION_ATTR, "custom-lvct-followups");
    assert.equal(EXCHANGES_SECTION_ATTR, "custom-lvct-exchanges");
    assert.equal(ANNIVERSARIES_SECTION_ATTR, "custom-lvct-anniversaries");
});

test("profileSectionMarkdown：生成人脉基本档案 Markdown 区块", () => {
    const person: ContactSummary = {
        docId: "20261023000000-doc001",
        itemId: "item-001",
        name: "张三",
        phone: "13800000000",
        wechat: "zhangsan_wx",
        email: "zhangsan@example.com",
        website: "",
        birthday: "1990-05-20",
        isLunar: false,
        group: "同事",
        tags: ["投资", "合伙人"],
        relatedItemIds: [],
    };
    const md = profileSectionMarkdown(person);
    assert.match(md, /## 人脉基本档案/);
    assert.match(md, /- \*\*电话\*\*：13800000000/);
    assert.match(md, /- \*\*微信\*\*：zhangsan_wx/);
    assert.match(md, /- \*\*邮箱\*\*：zhangsan@example\.com/);
    assert.match(md, /- \*\*生日\*\*：1990-05-20/);
    assert.match(md, /- \*\*分组\*\*：同事/);
    assert.match(md, /- \*\*标签\*\*：#投资 #合伙人/);
});

test("interactionSectionMarkdown：生成往来记录 Markdown 列表与图标映射", () => {
    const events: InteractionEvent[] = [
        {
            id: "event-1",
            personDocId: "20261023000000-doc001",
            occurredAt: 1761234567000,
            localDate: "2026-10-22",
            type: "meet",
            note: "在金鹰世界见面聊工作",
            source: "manual",
        },
        {
            id: "event-2",
            personDocId: "20261023000000-doc001",
            occurredAt: 1761100000000,
            localDate: "2026-10-20",
            type: "call",
            note: "电话同步进度",
            source: "manual",
        },
    ];
    const md = interactionSectionMarkdown(events);
    assert.match(md, /## 往来记录/);
    assert.match(md, /- 2026-10-22 🤝 见面：在金鹰世界见面聊工作/);
    assert.match(md, /- 2026-10-20 📞 电话：电话同步进度/);
});

test("followupsSectionMarkdown：生成待办跟进任务 Markdown", () => {
    const items: FollowUpItem[] = [
        {
            id: "fu-1",
            personDocId: "doc-1",
            title: "跟进合同签署",
            dueDate: "2026-10-30",
            status: "open",
        },
        {
            id: "fu-2",
            personDocId: "doc-1",
            title: "已发送初稿",
            dueDate: "2026-10-20",
            status: "done",
        },
        {
            id: "fu-3",
            personDocId: "doc-1",
            title: "已取消事项",
            dueDate: "2026-10-15",
            status: "cancelled",
        },
    ];
    const md = followupsSectionMarkdown(items);
    assert.match(md, /## 待办跟进/);
    assert.match(md, /- \[ \] 📅2026-10-30 跟进合同签署/);
    assert.match(md, /- \[x\] 📅2026-10-20 已发送初稿/);
    assert.equal(md.includes("已取消事项"), false, "已取消事项不应出现在跟进清单中");
});

test("exchangesSectionMarkdown：生成人情往来记录", () => {
    const items: ExchangeRecord[] = [
        {
            id: "ex-1",
            personDocId: "doc-1",
            kind: "item",
            direction: "payable",
            description: "中秋月饼礼盒",
            amount: 398,
            currency: "¥",
            occurredOn: "2026-09-10",
            dueOn: "",
            status: "settled",
            settledOn: "2026-09-10",
            note: "",
            createdAt: 1000,
            updatedAt: 1000,
        },
        {
            id: "ex-2",
            personDocId: "doc-1",
            kind: "item",
            direction: "receivable",
            description: "特级龙井茶",
            currency: "¥",
            occurredOn: "2026-05-20",
            dueOn: "",
            status: "open",
            settledOn: "",
            note: "",
            createdAt: 1000,
            updatedAt: 1000,
        },
    ];
    const md = exchangesSectionMarkdown(items);
    assert.match(md, /## 人情往来/);
    assert.match(md, /- 2026-09-10 应付\/送出：中秋月饼礼盒 \(¥398\) \[已结清\]/);
    assert.match(md, /- 2026-05-20 应收\/收到：特级龙井茶 \[进行中\]/);
});

test("anniversariesSectionMarkdown：生成纪念日记录", () => {
    const items: AnniversaryItem[] = [
        {
            id: "an-1",
            personDocId: "doc-1",
            title: "结婚纪念日",
            date: "05-20",
            isLunar: false,
        },
        {
            id: "an-2",
            personDocId: "doc-1",
            title: "生日",
            date: "1992-08-15",
            isLunar: true,
        },
    ];
    const md = anniversariesSectionMarkdown(items);
    assert.match(md, /## 重要纪念日/);
    assert.match(md, /- 结婚纪念日：05-20/);
    assert.match(md, /- 生日：1992-08-15（农历）/);
});
