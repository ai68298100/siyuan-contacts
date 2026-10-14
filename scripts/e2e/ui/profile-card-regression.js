import { mount, unmount, tick } from "svelte";
import PersonCard from "../../../src/components/people/PersonCard.svelte";

const person = {
    docId: "20261011000000-person1", itemId: "20261011000000-row0001", name: "卡片资料核对",
    phone: "", email: "", wechat: "", website: "", birthday: "", isLunar: false,
    group: "", tags: [], relatedItemIds: [],
};

function affiliations(patch = {}) {
    return { family: [], work: [], education: [], unspecified: [], history: [], unresolved: [], ...patch };
}

function knownProfile(value = affiliations()) {
    return {
        readAt: 1791676800000,
        affiliations: { state: "known", value },
        relationship: { state: "known", labels: [], recordId: null, updatedAt: null },
    };
}

function membership(patch = {}) {
    return {
        id: "20261011000000-member1", orgDocId: "20261011000000-org0001", personDocId: person.docId,
        department: "", title: "", joinedOn: "", leftOn: "", status: "active",
        affiliationKind: "unspecified", orgName: "社区读书会", scope: "current", ...patch,
    };
}

async function withCard(fixture, data, inspect) {
    const host = document.createElement("div");
    host.style.width = "min(260px, 100%)";
    fixture.appendChild(host);
    const instance = mount(PersonCard, { target: host, props: {
        person: data, onOpen() {}, onOpenPersonDoc() {},
    } });
    try {
        await tick();
        await inspect(host.querySelector(".lvct-person-card"));
    } finally {
        await unmount(instance);
        host.remove();
    }
}

const summaryRows = (card) => [...card.querySelectorAll(".lvct-profile-summary--compact > span")].map((node) => node.textContent);

export async function runProfileCardRegression({ test, assert, fixture }) {
    await test("联系人卡片精简资料：已核实空资料显示补充提示，不重复四条未填写", async () => {
        await withCard(fixture, { ...person, profile: knownProfile() }, (card) => {
            const rows = summaryRows(card);
            assert(rows.length === 1 && rows[0] === "资料待补充", "空资料未收敛为单条补充提示");
            assert(!card.textContent.includes("：未填写"), "精简卡片仍重复显示空字段");
        });
    });

    const retainedCases = [
        { name: "其他组织", field: "unspecified", item: membership(), expected: "其他组织：社区读书会" },
        { name: "毕业历史", field: "history", item: membership({ status: "former", affiliationKind: "education", orgName: "原就读学校", scope: "former" }), expected: "历史组织：1 条经历" },
        { name: "待核对组织", field: "unresolved", item: membership({ orgName: null, scope: "unreachable" }), expected: "待核对组织：1 条" },
    ];
    for (const entry of retainedCases) {
        await test(`联系人卡片精简资料：仅有${entry.name}仍保留摘要，不误判空资料`, async () => {
            const profile = knownProfile(affiliations({ [entry.field]: [entry.item] }));
            await withCard(fixture, { ...person, profile }, (card) => {
                const rows = summaryRows(card);
                assert(rows.length === 1 && rows[0].includes(entry.expected), `${entry.name}资料未保留在卡片摘要中`);
                assert(!card.textContent.includes("资料待补充"), `${entry.name}被错误显示为空资料`);
            });
        });
    }

    for (const entry of [
        { state: "unknown", expected: "称谓尚未核实", name: "称谓读取异常" },
        { state: "self_missing", expected: "请先设置本人", name: "未设置本人" },
    ]) {
        await test(`联系人卡片精简资料：组织异常合并为一条，${entry.name}提示仍保留`, async () => {
            const profile = {
                readAt: 1791676800000,
                affiliations: { state: "unknown", message: "组织索引读取失败" },
                relationship: { state: entry.state, labels: null },
            };
            await withCard(fixture, { ...person, profile }, (card) => {
                const rows = summaryRows(card);
                assert(rows.length === 2, "读取异常重复成多条组织提示或丢失称谓状态");
                assert(rows.filter((row) => row === "组织归属：组织归属尚未核实").length === 1, "组织未知没有保留且仅保留一条核对提示");
                assert(rows.some((row) => row === `与我的关系：${entry.expected}`), `${entry.name}被隐藏或误判为空资料`);
                assert(!card.textContent.includes("资料待补充"), "异常资料被写成正常空资料");
            });
        });
    }

    await test("联系人卡片联系方式：窄卡片完整换行长电话、微信和邮箱，文字不裁切", async () => {
        const data = {
            ...person,
            phone: "+86 138 0000 0000 / +86 139 0000 0000（工作日联系）",
            wechat: "community_coordinator_".repeat(5),
            email: `${"contact-community-coordination-".repeat(2)}@long-organization-domain.example.test`,
        };
        await withCard(fixture, data, (card) => {
            const values = [...card.querySelectorAll(".lvct-person-card__meta-value")].slice(0, 3);
            assert(values.length === 3, "联系方式文字容器缺失");
            for (const [index, value] of values.entries()) {
                const expected = [data.phone, data.wechat, data.email][index];
                assert(value.textContent === expected, "长联系方式在渲染时被截断");
                const rect = value.getBoundingClientRect();
                const lineHeight = Number.parseFloat(getComputedStyle(value).lineHeight);
                assert(rect.height >= lineHeight * 1.8, `长联系方式没有换行：${expected}`);
                assert(value.scrollWidth <= value.clientWidth + 1 && value.scrollHeight <= value.clientHeight + 1, `联系方式在文字容器中被裁切：${expected}`);
                const range = document.createRange();
                range.selectNodeContents(value);
                assert([...range.getClientRects()].every((line) => line.left >= rect.left - 1 && line.right <= rect.right + 1 && line.top >= rect.top - 1 && line.bottom <= rect.bottom + 1), `部分联系方式文字落在可见容器外：${expected}`);
            }
            assert(card.scrollWidth <= card.clientWidth + 1, "长联系方式撑出了卡片宽度");
            assert(card.querySelector('a[href^="tel:"]')?.getAttribute("href") === `tel:${data.phone}`, "电话链接丢失完整号码");
            assert(card.querySelector('a[href^="mailto:"]')?.getAttribute("href") === `mailto:${data.email}`, "邮箱链接丢失完整地址");
        });
    });

    await test("联系人卡片图标：宿主通用 SVG 填充规则不把 Lucide 描边图标填实", async () => {
        const hostStyle = document.createElement("style");
        hostStyle.textContent = "svg { fill: currentColor; }";
        document.head.appendChild(hostStyle);
        try {
            await withCard(fixture, { ...person, phone: "13800000000", email: "contact@example.test", wechat: "test-contact" }, (card) => {
                const icons = [...card.querySelectorAll("svg")];
                assert(icons.length >= 5, "卡片联系方式和文档图标未完整渲染");
                assert(icons.every((icon) => getComputedStyle(icon).fill === "none"), "宿主样式把卡片描边图标填成实心");
            });
        } finally {
            hostStyle.remove();
        }
    });
}
