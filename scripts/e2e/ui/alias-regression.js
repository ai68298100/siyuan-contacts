import { mount, unmount, tick } from "svelte";
import PersonAliases from "../../../src/components/people/PersonAliases.svelte";
import PersonPicker from "../../../src/components/people/PersonPicker.svelte";
import { bindContactAliasStorage } from "../../../src/services/contact-aliases";
import { addPersonAlias, listPersonAliases, resolveAlias } from "../../../src/services/person-aliases";
import { listContacts, filterContacts } from "../../../src/services/contacts";
import { captureFromDoc } from "../../../src/services/capture";
import { invalidateRoster } from "../../../src/services/roster";
import { FIELD_SPECS } from "../../../src/domain/fields";
import { emptyDraft } from "../../../src/domain/person";

const sourceDocId = "20261004000000-source1";
const person = { ...emptyDraft(), docId: "20261004000000-person1", itemId: "20261004000000-item001", name: "张三", relatedItemIds: [] };
const peer = { ...person, docId: "20261004000000-person2", itemId: "20261004000000-item002", name: "老张" };

function configure(kernel, settings) {
    const state = { people: [person, peer], unavailable: new Set(), writes: [], calls: [], failAliases: false, store: {} };
    const plugin = {
        loadData: async (key) => {
            if (state.failAliases && key === "person-aliases.json") throw new Error("别名读取故障");
            return structuredClone(state.store[key] ?? null);
        },
        saveData: async (key, value) => { state.writes.push(key); state.store[key] = structuredClone(value); },
    };
    kernel.handler = async (route, body) => {
        state.calls.push({ route, body });
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: FIELD_SPECS.map((field) => ({ id: settings.fieldMap[field.key], name: field.nameZh, type: field.type })),
            rows: state.people.map((entry) => ({ id: entry.itemId, cells: [{ valueType: "block", value: {
                keyID: "primary", type: "block", block: { id: entry.docId, content: entry.name },
            } }] })),
        } };
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            const docId = body.stmt.match(/id\s*=\s*'([^']+)'/)?.[1];
            const entry = state.people.find((candidate) => candidate.docId === docId);
            if (state.unavailable.has(docId)) return [];
            if (docId === sourceDocId) return [{ id: docId, content: "虚构来源" }];
            return entry ? [{ id: entry.docId, content: entry.name }] : [];
        }
        throw new Error(`别名测试禁止额外内核写入 ${route}`);
    };
    invalidateRoster();
    return { state, plugin };
}

export async function runAliasRegression({ test, assert, kernel, settings, fixture, until }) {
    await test("AG-ALIAS-001 新增先核实唯一登记与可达性，重复添加幂等且泛称零保存", async () => {
        const { state, plugin } = configure(kernel, settings);
        const first = await addPersonAlias(plugin, person.docId, "Alice", settings);
        const again = await addPersonAlias(plugin, person.docId, " ALICE ", settings);
        assert(first.id === again.id && state.writes.length === 1, "重复添加未复用稳定别名身份");
        for (const alias of ["王总", "昵称\n另一称呼"]) {
            let rejected = false;
            try { await addPersonAlias(plugin, person.docId, alias, settings); } catch { rejected = true; }
            assert(rejected && state.writes.length === 1, "泛称或控制字符仍写入");
        }
        state.unavailable.add(person.docId);
        let unavailable = false;
        try { await addPersonAlias(plugin, person.docId, "第二昵称", settings); } catch { unavailable = true; }
        assert(unavailable && state.writes.length === 1, "失效人物仍保存别名");
    });

    await test("AG-ALIAS-001 别名撞姓名共同消歧，孤儿和重复绑定不按新人解析", async () => {
        const { state, plugin } = configure(kernel, settings);
        await addPersonAlias(plugin, person.docId, "老张", settings);
        const collision = await resolveAlias(plugin, " 老张 ", settings);
        assert(collision.status === "ambiguous" && collision.personDocIds.includes(peer.docId), "别名覆盖他人真实姓名");
        const captured = await captureFromDoc(plugin, settings, sourceDocId, { personDocIds: [], newNames: ["老张"], date: "2026-10-04" });
        assert(!captured.complete && captured.interactions === 0 && captured.createdDocIds.length === 0 && state.writes.length === 1,
            "重名冲突仍创建人物或互动");
        state.people = [peer];
        assert((await resolveAlias(plugin, "老张", settings)).status === "unavailable", "孤儿别名被当作他人姓名或新人");
        const orphan = await captureFromDoc(plugin, settings, sourceDocId, { personDocIds: [], newNames: ["老张"], date: "2026-10-04" });
        assert(!orphan.complete && state.writes.length === 1, "孤儿身份仍写入");
        state.people = [person, { ...person, itemId: peer.itemId }];
        assert((await resolveAlias(plugin, "老张", settings)).status === "unavailable", "多重绑定未阻断识别");
    });

    await test("AG-ALIAS-001 仍在名册但人物文档失效时捕获零互动、零新建", async () => {
        const { state, plugin } = configure(kernel, settings);
        await addPersonAlias(plugin, person.docId, "Alice", settings);
        state.unavailable.add(person.docId);
        const captured = await captureFromDoc(plugin, settings, sourceDocId, { personDocIds: [], newNames: ["Alice"], date: "2026-10-04" });
        assert(!captured.complete && captured.interactions === 0 && state.writes.length === 1
            && !state.calls.some((call) => call.route === "/api/filetree/createDocWithMd"), "失效人物仍产生往来或建档");
    });

    await test("AG-ALIAS-001 列表搜索与选人器读取别名，碰撞候选显示稳定 ID", async () => {
        const { plugin } = configure(kernel, settings);
        await addPersonAlias(plugin, person.docId, "老张", settings);
        const detach = bindContactAliasStorage(plugin);
        let component;
        try {
            const people = await listContacts(settings);
            assert(filterContacts(people, "老张").length === 2, "列表未同时显示姓名与别名候选");
            let selected = "";
            component = mount(PersonPicker, { target: fixture, props: {
                items: people.map((entry) => ({ id: entry.itemId, docId: entry.docId, itemId: entry.itemId, label: entry.name })),
                onSelect: (id) => { selected = id; },
            } });
            fixture.querySelector("button").click();
            await tick();
            const search = fixture.querySelector("input");
            search.value = "老张";
            search.dispatchEvent(new Event("input", { bubbles: true }));
            await until(() => fixture.querySelectorAll("[role=option]").length === 2
                && fixture.textContent.includes(person.docId) && fixture.textContent.includes(peer.docId), "选人器别名候选未到达");
            assert(fixture.textContent.includes(person.docId) && fixture.textContent.includes(peer.docId), "碰撞候选缺少稳定 ID");
            [...fixture.querySelectorAll("[role=option]")].find((entry) => entry.textContent.includes(person.docId)).click();
            assert(selected === person.itemId, "选人器未按具体候选 ID 返回");
        } finally { if (component) await unmount(component); detach(); }
    });

    await test("AG-ALIAS-001 读取故障保留未知，重复添加 UI 不重复记录", async () => {
        const { state, plugin } = configure(kernel, settings);
        const detach = bindContactAliasStorage(plugin);
        let component;
        try {
            state.failAliases = true;
            const people = await listContacts(settings);
            assert(people.every((entry) => entry.aliasProfile?.state === "unknown"), "读取失败伪装无别名");
            state.failAliases = false;
            await addPersonAlias(plugin, person.docId, "Alice", settings);
            component = mount(PersonAliases, { target: fixture, props: {
                personDocId: person.docId, onLoad: (docId) => listPersonAliases(plugin, docId),
                onAdd: (docId, alias) => addPersonAlias(plugin, docId, alias, settings), onRemove: async () => {}, onChanged: () => {},
            } });
            await until(() => fixture.querySelectorAll(".lvct-person-aliases__item").length === 1, "已有别名未显示");
            const draft = fixture.querySelector("input");
            draft.value = "ALICE";
            draft.dispatchEvent(new Event("input", { bubbles: true }));
            await tick();
            [...fixture.querySelectorAll("button")].find((entry) => entry.textContent.trim() === "添加").click();
            await until(() => draft.value === "", "重复添加未完成");
            assert(fixture.querySelectorAll(".lvct-person-aliases__item").length === 1 && state.writes.length === 1,
                "重复保存产生重复 UI 或存储写入");
        } finally { if (component) await unmount(component); detach(); }
    });
}
