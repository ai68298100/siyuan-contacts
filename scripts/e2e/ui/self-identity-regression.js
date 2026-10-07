import { loadSelfIdentity, saveSelfIdentity, bindSelfIdentityStorage, SELF_IDENTITY_STORAGE_KEY } from "../../../src/data/self-identity";
import { ensureSelfIdentity, previewSelfIdentityChange, applySelfIdentityChange, SELF_PROFILE_CHECKPOINT_KEY } from "../../../src/services/self-identity";
import { kernelConfig } from "../../../src/api/client";
import { mount, unmount, tick } from "svelte";
import InitWizard from "../../../src/components/InitWizard.svelte";
import SettingsView from "../../../src/components/SettingsView.svelte";
import { DEFAULT_VIEW_PREFERENCES } from "../../../src/domain/preferences";
import { loadDashboard } from "../../../src/services/dashboard";
import DashboardView from "../../../src/components/dashboard/DashboardView.svelte";
import { exportMigrationBundle, importMigrationBundle, previewMigrationImport } from "../../../src/services/migration-bundle";
import { getRoster, invalidateRoster } from "../../../src/services/roster";
import { FIELD_SPECS } from "../../../src/domain/fields";

const identity = { schemaVersion: 1, selfDocId: "20261004000000-self001", selfItemId: "20261004000000-row0001", createdAt: "2026-10-04" };

function configureSelfKernel(kernel, settings) {
    invalidateRoster();
    const state = {
        files: new Map([["contacts-settings.json", settings]]), writes: [],
        rows: [], map: {}, docPresent: true, failReads: false, failAfterSave: false,
        mapCalls: 0, loseBindingAfterSave: false, kernelWrites: [],
    };
    state.plugin = {
        loadData: async (key) => {
            if (key === SELF_IDENTITY_STORAGE_KEY && (state.failReads || state.failAfterSave && state.writes.includes(key))) throw new Error("本人身份读取失败");
            return structuredClone(state.files.has(key) ? state.files.get(key) : "");
        },
        saveData: async (key, value) => { state.writes.push(key); state.files.set(key, structuredClone(value)); },
    };
    state.row = (docId = identity.selfDocId, itemId = identity.selfItemId, name = "我自己") => ({ id: itemId, cells: [{
        valueType: "block", value: { type: "block", keyID: "name", block: { id: docId, content: name } },
    }] });
    state.rows = [state.row()];
    state.map = { [identity.selfDocId]: identity.selfItemId };
    kernel.handler = async (route, body) => {
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })), rows: structuredClone(state.rows),
        } };
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") {
            state.mapCalls += 1;
            if (state.loseBindingAfterSave && state.writes.includes(SELF_IDENTITY_STORAGE_KEY)) throw new Error("写后绑定回读失败");
            return structuredClone(state.map);
        }
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            const docId = body.stmt.match(/(?:WHERE|AND) id\s*=\s*'([^']+)'/)?.[1] ?? identity.selfDocId;
            return state.docPresent ? [{ id: docId }] : [];
        }
        state.kernelWrites.push(route);
        throw new Error(`本人身份夹具拒绝 ${route}`);
    };
    return state;
}

const identityBundle = (value = identity) => JSON.stringify({
    schemaVersion: 1, storageKey: "lvct-migration-bundle", modules: { selfIdentity: { schemaVersion: 1, identity: value } },
});

function configureProfileKernel(kernel, settings) {
    const state = {
        files: new Map(), writes: [], docs: new Map(), rows: new Map(), creates: 0, binds: 0, pages: [],
        loseCreate: false, loseBind: false, failBind: false, hideMarker: false, duplicateMarker: false,
        failScan: false, failMarker: false, failIdentityReadback: false, failCheckpointReadback: false,
    };
    state.plugin = {
        loadData: async (key) => {
            if (key === SELF_IDENTITY_STORAGE_KEY && state.failIdentityReadback && state.files.has(key)
                || key === SELF_PROFILE_CHECKPOINT_KEY && state.failCheckpointReadback && state.files.has(key)) throw new Error("保存后读取失败");
            return structuredClone(state.files.get(key) ?? "");
        },
        saveData: async (key, value) => { state.writes.push(key); state.files.set(key, structuredClone(value)); },
    };
    state.doc = (id = identity.selfDocId, name = "我自己") => {
        const doc = { id, content: name, hpath: `/${settings.notebookName}/${name}` };
        state.docs.set(id, doc);
        return doc;
    };
    kernel.handler = async (route, body) => {
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/av/renderAttributeView") return { view: {
            columns: FIELD_SPECS.map((field) => ({ id: field.key, name: field.nameZh, type: field.type })), rows: structuredClone([...state.rows.values()]),
        } };
        if (route === "/api/query/sql") {
            if (body.stmt.includes("SELECT DISTINCT root_id")) {
                if (state.failMarker) throw new Error("本人请求标记读取失败");
                if (state.hideMarker) return [];
                const requestId = body.stmt.match(/custom-lvct-self-draft="([^"]+)"/)?.[1];
                const roots = [...state.docs.values()].filter((doc) => doc.requestId === requestId).map((doc) => ({ root_id: doc.id }));
                if (state.duplicateMarker && roots.length) roots.push({ root_id: "20261004000000-other01" });
                return roots;
            }
            const docId = body.stmt.match(/(?:WHERE|AND) id\s*=\s*'([^']+)'/)?.[1];
            if (docId) return state.docs.has(docId) ? [structuredClone(state.docs.get(docId))] : [];
            if (state.failScan) throw new Error("本人候选文档读取失败");
            const after = body.stmt.match(/id > '([^']+)'/)?.[1];
            state.pages.push(after);
            const limit = Number(body.stmt.match(/LIMIT (\d+)/)?.[1]);
            return [...state.docs.values()].sort((left, right) => left.id.localeCompare(right.id))
                .filter((doc) => !after || doc.id > after).slice(0, limit).map((doc) => structuredClone(doc));
        }
        if (route === "/api/filetree/createDocWithMd") {
            state.creates += 1;
            const doc = state.doc();
            doc.requestId = body.markdown.match(/custom-lvct-self-draft="([^"]+)"/)?.[1];
            if (state.loseCreate) return new Promise(() => {});
            return doc.id;
        }
        if (route === "/api/av/getAttributeViewItemIDsByBoundIDs") {
            return Object.fromEntries(body.blockIDs.flatMap((docId) => {
                const row = [...state.rows.values()].find((candidate) => candidate.cells[0].value.block.id === docId);
                return row ? [[docId, row.id]] : [];
            }));
        }
        if (route === "/api/av/addAttributeViewBlocks") {
            state.binds += 1;
            if (state.failBind) throw new Error("本人绑定未应用");
            for (const source of body.srcs) state.rows.set(identity.selfItemId, { id: identity.selfItemId, cells: [{
                valueType: "block", value: { type: "block", keyID: "name", block: { id: source.id, content: state.docs.get(source.id).content } },
            }] });
            if (state.loseBind) return new Promise(() => {});
            return null;
        }
        throw new Error(`本人断点夹具拒绝未知请求 ${route}`);
    };
    invalidateRoster();
    return state;
}

export async function runSelfIdentityRegression({ test, assert, kernel, settings, fixture, until, button }) {
    await test("AG-B11-004 本人保留名册，统计/生日/联系/跟进行动排除且身份清除后重算", async () => {
        const state = configureSelfKernel(kernel, settings);
        state.files.set(SELF_IDENTITY_STORAGE_KEY, identity);
        const other = { docId: "20261004000000-other01", itemId: "20261004000000-row0002" };
        state.rows.push(state.row(other.docId, other.itemId, "普通联系人"));
        const today = new Date();
        const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        for (const row of state.rows) row.cells.push({ valueType: "date", value: { type: "date", keyID: "birthday", date: { content: new Date(1990, today.getMonth(), today.getDate()).getTime(), isNotEmpty: true } } });
        state.files.set("follow-ups.json", { schemaVersion: 1, items: [identity.selfDocId, other.docId].map((docId, index) => ({
            id: `follow-${index}`, personDocId: docId, title: "本人或他人的计划", dueDate: dateKey, status: "open", createdAt: Date.now(), updatedAt: Date.now(),
        })) });
        const first = await loadDashboard(state.plugin, settings);
        assert(first.people === 1 && first.birthdays.length === 1 && first.neverContacted === 1 && first.followUps.length === 1, "普通统计或计划混入本人");
        assert(first.actions.every((card) => card.person.docId !== identity.selfDocId) && first.excludedSelfDocId === identity.selfDocId, "本人进入待联系行动或无排除解释");
        assert(state.files.get("follow-ups.json").items.length === 2 && (await getRoster(settings)).length === 2, "排除规则删除本人事实");
        state.files.set(SELF_IDENTITY_STORAGE_KEY, null);
        invalidateRoster();
        const cleared = await loadDashboard(state.plugin, settings);
        assert(cleared.people === 2 && cleared.followUps.length === 2 && cleared.birthdays.length === 2, "清除本人后统计未重算");
    });
    await test("AG-B11-004 身份读取失败或行失配，提醒范围未知不按普通联系人处理", async () => {
        const state = configureSelfKernel(kernel, settings);
        state.files.set(SELF_IDENTITY_STORAGE_KEY, { ...identity, selfItemId: "20261004000000-row0002" });
        const mismatch = await loadDashboard(state.plugin, settings);
        assert(mismatch.ordinaryScopeUnknown && mismatch.readFailures.includes("self") && mismatch.actions.length === 0 && mismatch.stale.length === 0, "失配本人误生成提醒");
        state.failReads = true;
        const failed = await loadDashboard(state.plugin, settings);
        assert(failed.ordinaryScopeUnknown && failed.actions.length === 0 && failed.followUps.length === 0, "读失败按无本人显示正常范围");
        state.failReads = false;
        state.files.set(SELF_IDENTITY_STORAGE_KEY, identity);
        const restored = await loadDashboard(state.plugin, settings);
        assert(!restored.ordinaryScopeUnknown && restored.excludedSelfDocId === identity.selfDocId, "身份恢复仍停在未知");
    });
    await test("AG-B11-004 首页未知显示未核实与破折号，禁生日/从未互动下钻", async () => {
        const state = configureSelfKernel(kernel, settings);
        state.files.set(SELF_IDENTITY_STORAGE_KEY, { ...identity, selfItemId: "20261004000000-row0002" });
        const data = await loadDashboard(state.plugin, settings);
        const mounted = mount(DashboardView, { target: fixture, props: {
            facade: { loadDashboard: async () => data }, preferences: DEFAULT_VIEW_PREFERENCES,
            onOpenDetail() {}, onOpenPeople() {}, onOpenGraph() {},
        } });
        try {
            await until(() => fixture.textContent.includes("普通联系人统计与提醒暂停"), "未知身份没有解释");
            assert([...fixture.querySelectorAll(".lvct-dash__stat b")].every((node) => node.textContent === "—"), "未知统计显示为 0");
            assert(!fixture.textContent.includes("今天没有需要处理的事") && !fixture.textContent.includes("先添加一位联系人"), "未知提醒误报空态");
            assert(fixture.querySelectorAll(".lvct-dash__stat:disabled").length === 2, "未知生日和从未互动仍可下钻");
        } finally { await unmount(mounted); }
    });
    await test("AG-B11-003 指定/换绑只读预览，原资料保留且取消零写入", async () => {
        const state = configureSelfKernel(kernel, settings);
        state.files.set(SELF_IDENTITY_STORAGE_KEY, identity);
        const target = { selfDocId: "20261004000000-other01", selfItemId: "20261004000000-row0002" };
        state.rows.push(state.row(target.selfDocId, target.selfItemId, "同名本人"));
        state.map[target.selfDocId] = target.selfItemId;
        const preview = await previewSelfIdentityChange(state.plugin, settings, target.selfItemId);
        assert(preview.target.docId === target.selfDocId && preview.ordinaryBefore === 1 && preview.ordinaryAfter === 1 && state.writes.length === 0, "预览发生写入或丢失目标 ID");
        const result = await applySelfIdentityChange(state.plugin, settings, preview);
        assert(result.selfDocId === target.selfDocId && result.createdAt === identity.createdAt && state.rows.length === 2, "换绑改动原人物资料");
        const writes = state.writes.length;
        await applySelfIdentityChange(state.plugin, settings, preview);
        assert(state.writes.length === writes, "重复确认重新保存");
    });
    await test("AG-B11-003 清除仅取消身份与断点，未知先核实、重复确认零重写", async () => {
        const state = configureSelfKernel(kernel, settings);
        state.files.set(SELF_IDENTITY_STORAGE_KEY, identity);
        state.files.set(SELF_PROFILE_CHECKPOINT_KEY, { schemaVersion: 9 });
        state.files.set("org-membership.json", { history: ["保留"] });
        const preview = await previewSelfIdentityChange(state.plugin, settings, null);
        assert(preview.ordinaryAfter === 1 && state.writes.length === 0, "清除预览不正确");
        state.failAfterSave = true;
        let error;
        try { await applySelfIdentityChange(state.plugin, settings, preview); } catch (cause) { error = cause; }
        assert(error?.message.includes("未知") && state.files.get(SELF_IDENTITY_STORAGE_KEY) === null, "未保留清除写后未知");
        state.failAfterSave = false;
        const writes = state.writes.length;
        assert(await applySelfIdentityChange(state.plugin, settings, preview) === null && state.writes.length === writes, "已清除重试重复写入");
        assert(state.rows.length === 1 && state.files.get("org-membership.json").history[0] === "保留", "清除删除原文档或历史");
        assert(state.files.get(SELF_PROFILE_CHECKPOINT_KEY) === null, "清除后旧断点仍会重建身份");
    });
    await test("AG-B11-003 预览后另一窗口换绑/目标解绑/锚点变化拒绝覆盖", async () => {
        const state = configureSelfKernel(kernel, settings);
        state.files.set(SELF_IDENTITY_STORAGE_KEY, identity);
        const preview = await previewSelfIdentityChange(state.plugin, settings, null);
        state.files.set(SELF_IDENTITY_STORAGE_KEY, { ...identity, selfDocId: "20261004000000-other01" });
        let error;
        try { await applySelfIdentityChange(state.plugin, settings, preview); } catch (cause) { error = cause; }
        assert(error?.message.includes("重新预览") && state.writes.length === 0, "覆盖并发身份");
        state.files.delete(SELF_IDENTITY_STORAGE_KEY);
        const designation = await previewSelfIdentityChange(state.plugin, settings, identity.selfItemId);
        state.rows[0].id = "20261004000000-row0002";
        try { await applySelfIdentityChange(state.plugin, settings, designation); } catch (cause) { error = cause; }
        assert(error?.message.includes("绑定行已变化") && state.writes.length === 0, "目标行变化后仍指定");
        try { await applySelfIdentityChange(state.plugin, { ...settings, avId: "20261004000000-other01" }, designation); } catch (cause) { error = cause; }
        assert(error?.message.includes("工作空间已变化") && state.writes.length === 0, "锚点变化后仍执行");
    });
    await test("AG-B11-003 设置先预览再确认，取消零写入且键盘可定位影响", async () => {
        const state = configureSelfKernel(kernel, settings);
        const facade = {
            loadSelfIdentity: () => loadSelfIdentity(state.plugin),
            listContacts: async () => { invalidateRoster(); return getRoster(settings); },
            previewSelfIdentityChange: (target) => previewSelfIdentityChange(state.plugin, settings, target),
            applySelfIdentityChange: (preview) => applySelfIdentityChange(state.plugin, settings, preview),
        };
        const mounted = mount(SettingsView, { target: fixture, props: {
            facade, settings, preferences: DEFAULT_VIEW_PREFERENCES, onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
        } });
        try {
            await until(() => fixture.querySelector('select[aria-label="选择联系人…"]'), "旧库不能指定已有本人");
            const picker = fixture.querySelector('select[aria-label="选择联系人…"]');
            if (window.innerWidth <= 640) {
                const row = picker.closest(".lvct-settings__identity-row");
                const controls = row?.querySelector(".lvct-settings__identity-controls");
                assert(row && controls, "移动端本人改绑控件缺少专用布局容器");
                const controlsRect = controls.getBoundingClientRect();
                assert(controlsRect.left >= -1 && controlsRect.right <= window.innerWidth + 1,
                    `移动端本人改绑控件横向溢出：${controlsRect.left}..${controlsRect.right} / ${window.innerWidth}`);
                assert(picker.getBoundingClientRect().width <= controlsRect.width + 1,
                    "移动端本人改绑选择器未收缩到容器宽度");
            }
            picker.value = identity.selfItemId;
            picker.dispatchEvent(new Event("change", { bubbles: true }));
            await tick();
            button("预览指定本人").click();
            await until(() => fixture.textContent.includes("本人身份影响预览"), "未显示影响预览");
            assert(state.writes.length === 0 && document.activeElement.getAttribute("aria-label") === "本人身份影响预览", "预览写入或未恢复焦点");
            button("取消本人预览").click();
            await tick();
            assert(state.writes.length === 0, "取消发生写入");
            button("预览指定本人").click();
            await until(() => fixture.textContent.includes("确认本人身份变更"), "取消后不可重新预览");
            button("确认本人身份变更").click();
            await until(() => fixture.textContent.includes("本人身份已改绑"), "确认后没有结果");
            button("预览清除本人身份").click();
            await until(() => fixture.textContent.includes("确认本人身份变更"), "清除预览未显示");
            button("确认本人身份变更").click();
            await until(() => fixture.textContent.includes("已清除本人身份"), "清除未显示结果");
            assert(await loadSelfIdentity(state.plugin) === null, "清除没有落盘");
        } finally { await unmount(mounted); }
    });
    await test("AG-B11-003 本人读取损坏显示未知，禁止创建并可核实恢复", async () => {
        let broken = true;
        let creates = 0;
        const mounted = mount(SettingsView, { target: fixture, props: {
            facade: { loadSelfIdentity: async () => { if (broken) throw new Error("本人坏版本"); return null; }, listContacts: async () => [], createSelfProfile: async () => { creates += 1; } },
            settings, preferences: DEFAULT_VIEW_PREFERENCES, onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
        } });
        try {
            await until(() => fixture.textContent.includes("本人身份尚未核实"), "坏身份误显空态");
            assert(!fixture.textContent.includes("创建本人档案「我自己」") && creates === 0, "损坏读仍允许创建");
            broken = false;
            button("重新核实本人身份").click();
            await until(() => fixture.textContent.includes("创建本人档案「我自己」"), "读取恢复无法继续");
        } finally { await unmount(mounted); }
    });
    await test("AG-B11-002 本人创建/绑定响应丢失，核实原文档和行，重复及并发仅一份", async () => {
        const state = configureProfileKernel(kernel, settings);
        state.loseCreate = true;
        state.loseBind = true;
        const originalTimeout = kernelConfig.timeoutMs;
        kernelConfig.timeoutMs = 50;
        try {
            const results = await Promise.all([ensureSelfIdentity(state.plugin, settings), ensureSelfIdentity(state.plugin, settings)]);
            assert(results.every((value) => value.selfDocId === identity.selfDocId), "并发本人身份不一致");
            assert(state.creates === 1 && state.binds === 1 && state.rows.size === 1, "响应丢失后重复建档或绑行");
            const saves = state.writes.filter((key) => key === SELF_IDENTITY_STORAGE_KEY).length;
            await ensureSelfIdentity(state.plugin, settings);
            assert(state.writes.filter((key) => key === SELF_IDENTITY_STORAGE_KEY).length === saves, "完成后重复写身份");
        } finally { kernelConfig.timeoutMs = originalTimeout; }
    });
    await test("AG-B11-002 未知创建跨调用只核实；找回前不重发，找回后原 ID 续做", async () => {
        const state = configureProfileKernel(kernel, settings);
        state.hideMarker = true;
        let error;
        try { await ensureSelfIdentity(state.plugin, settings); } catch (cause) { error = cause; }
        assert(error?.message.includes("未知") && state.creates === 1 && state.binds === 0, "未知创建被当作成功");
        try { await ensureSelfIdentity(state.plugin, settings); } catch (cause) { error = cause; }
        assert(state.creates === 1 && state.binds === 0, "未知结果盲重发");
        state.hideMarker = false;
        const result = await ensureSelfIdentity(state.plugin, settings);
        assert(result.selfDocId === identity.selfDocId && state.creates === 1 && state.binds === 1, "恢复后没有续用原请求");
    });
    await test("AG-B11-002 绑定失败后改名仍按原断点继续，保留已有文档资料", async () => {
        const state = configureProfileKernel(kernel, settings);
        const doc = state.doc();
        state.failBind = true;
        let error;
        try { await ensureSelfIdentity(state.plugin, settings); } catch (cause) { error = cause; }
        assert(error?.message.includes("绑定结果") && state.creates === 0 && state.binds === 1, "未绑定残留没有复用");
        doc.content = "本人真实姓名";
        state.failBind = false;
        const result = await ensureSelfIdentity(state.plugin, settings);
        assert(result.selfDocId === doc.id && state.creates === 0 && state.rows.get(result.selfItemId).cells[0].value.block.content === "本人真实姓名", "改名后重建或清空资料");
    });
    await test("AG-B11-002 全量分页发现第 501 篇残留，歧义与扫描失败均零创建", async () => {
        const state = configureProfileKernel(kernel, settings);
        for (let index = 0; index < 500; index++) state.doc(`20261003000000-${String(index).padStart(7, "0")}`, `其他文档 ${index}`);
        state.doc();
        await ensureSelfIdentity(state.plugin, settings);
        assert(state.pages.length === 2 && state.creates === 0 && state.binds === 1, "仅扫首 500 篇导致重复建档");
        const ambiguous = configureProfileKernel(kernel, settings);
        ambiguous.doc();
        ambiguous.doc("20261004000000-other01");
        let error;
        try { await ensureSelfIdentity(ambiguous.plugin, settings); } catch (cause) { error = cause; }
        assert(error?.message.includes("多个未绑定") && ambiguous.writes.length === 0 && ambiguous.creates === 0, "歧义时有写入");
        ambiguous.failScan = true;
        try { await ensureSelfIdentity(ambiguous.plugin, settings); } catch (cause) { error = cause; }
        assert(error?.message.includes("读取失败") && ambiguous.creates === 0, "扫描失败绕过创建");
    });
    await test("AG-B11-002 断点写后未知阻止创建，身份写后未知先读事实不重复", async () => {
        const state = configureProfileKernel(kernel, settings);
        state.failCheckpointReadback = true;
        let error;
        try { await ensureSelfIdentity(state.plugin, settings); } catch (cause) { error = cause; }
        assert(error && state.creates === 0 && state.binds === 0, "断点尚未核实就发出创建");
        const saved = configureProfileKernel(kernel, settings);
        saved.failIdentityReadback = true;
        try { await ensureSelfIdentity(saved.plugin, settings); } catch (cause) { error = cause; }
        assert(error && saved.files.has(SELF_IDENTITY_STORAGE_KEY), "未模拟身份已存但回读未知");
        saved.failIdentityReadback = false;
        await ensureSelfIdentity(saved.plugin, settings);
        assert(saved.creates === 1 && saved.binds === 1 && saved.writes.filter((key) => key === SELF_IDENTITY_STORAGE_KEY).length === 1, "未知身份被重复保存");
    });
    await test("AG-B11-002 坏断点、锚点变化、重复标记与原文档丢失不新建替代", async () => {
        const state = configureProfileKernel(kernel, settings);
        state.failBind = true;
        try { await ensureSelfIdentity(state.plugin, settings); } catch {}
        const original = structuredClone(state.files.get(SELF_PROFILE_CHECKPOINT_KEY));
        for (const checkpoint of [{ schemaVersion: 99 }, { ...original, avId: "20261004000000-other01" }]) {
            state.files.set(SELF_PROFILE_CHECKPOINT_KEY, checkpoint);
            let error;
            try { await ensureSelfIdentity(state.plugin, settings); } catch (cause) { error = cause; }
            assert(error && state.creates === 1 && state.binds === 1, "坏断点或变更锚点未阻断");
        }
        state.files.set(SELF_PROFILE_CHECKPOINT_KEY, original);
        state.duplicateMarker = true;
        let error;
        try { await ensureSelfIdentity(state.plugin, settings); } catch (cause) { error = cause; }
        assert(error && state.creates === 1 && state.binds === 1, "重复请求标记被自动选择");
        state.docs.clear();
        try { await ensureSelfIdentity(state.plugin, settings); } catch (cause) { error = cause; }
        assert(error?.message.includes("不可达") && state.creates === 1, "原文档丢失后新建替代");
    });
    await test("AG-B11-002 向导可跳过本人，待续做提示保留入口且不阻断工作空间", async () => {
        let submitted;
        let entered = false;
        const mounted = mount(InitWizard, { target: fixture, props: {
            facade: { previewInitialize: async () => null, initialize: async (_name, progress, options) => {
                submitted = options;
                progress({ key: "wizardStepSelfPending", values: { message: "原本人结果未知" } });
                return settings;
            } }, onInitialized: () => { entered = true; },
        } });
        try {
            const checkbox = fixture.querySelector('input[type="checkbox"]');
            checkbox.click();
            button("开始初始化").click();
            await until(() => fixture.textContent.includes("本人档案尚未确认"), "本人失败没有可见提示");
            assert(submitted.createSelf === false && !entered && fixture.textContent.includes("原本人结果未知"), "跳过选项未提交或失败被吞");
            button("进入工作空间").click();
            assert(entered, "本人未完成阻断进入工作空间");
        } finally { await unmount(mounted); }
    });
    await test("AG-B11-002 设置页无本人时显示创建失败原因，保留安全重试", async () => {
        const mounted = mount(SettingsView, { target: fixture, props: {
            facade: { loadSelfIdentity: async () => null, listContacts: async () => [],
                createSelfProfile: async () => { throw new Error("原本人请求结果未知，未再次创建"); } },
            settings, preferences: DEFAULT_VIEW_PREFERENCES, onSettingsUpdated() {}, onPreferencesUpdated() {}, onBack() {},
        } });
        try {
            await until(() => fixture.textContent.includes("创建本人档案「我自己」"), "本人创建入口未显示");
            button("创建本人档案「我自己」").click();
            await until(() => fixture.textContent.includes("原本人请求结果未知"), "无身份时错误信息被隐藏");
            assert(!button("创建本人档案「我自己」").disabled, "错误后没有显式重试入口");
        } finally { await unmount(mounted); }
    });
    await test("AG-B11-001 本人旧库缺键与坏版本分开，损坏读取保存均零写入", async () => {
        const state = configureSelfKernel(kernel, settings);
        assert(await loadSelfIdentity(state.plugin) === null, "旧库缺键未按无本人处理");
        for (const value of [{ schemaVersion: 9 }, { ...identity, createdAt: "2026-02-31" }, { ...identity, selfItemId: "bad" }, false, []]) {
            state.files.set(SELF_IDENTITY_STORAGE_KEY, value);
            let readError;
            let writeError;
            try { await loadSelfIdentity(state.plugin); } catch (cause) { readError = cause; }
            try { await saveSelfIdentity(state.plugin, identity); } catch (cause) { writeError = cause; }
            assert(readError && writeError && state.writes.length === 0, "坏身份被按缺键重建");
            assert(JSON.stringify(state.files.get(SELF_IDENTITY_STORAGE_KEY)) === JSON.stringify(value), "原坏文件被覆盖");
        }
    });
    await test("AG-B11-001 本人保存输入校验、相同身份幂等与不同本人冲突", async () => {
        const state = configureSelfKernel(kernel, settings);
        let error;
        try { await saveSelfIdentity(state.plugin, { ...identity, selfDocId: "bad" }); } catch (cause) { error = cause; }
        assert(error && state.writes.length === 0, "非法本人输入写入");
        await saveSelfIdentity(state.plugin, identity);
        await saveSelfIdentity(state.plugin, identity);
        assert(state.writes.length === 1, "相同本人仍重写");
        try { await saveSelfIdentity(state.plugin, { ...identity, selfDocId: "20261004000000-other01" }); } catch (cause) { error = cause; }
        assert(error && state.writes.length === 1 && (await loadSelfIdentity(state.plugin)).selfDocId === identity.selfDocId, "不同本人被静默覆盖");
    });
    await test("AG-B11-001 已有本人绑定失配与同名多候选，不建档或自动选择", async () => {
        const state = configureSelfKernel(kernel, settings);
        state.files.set(SELF_IDENTITY_STORAGE_KEY, identity);
        state.rows[0].id = "20261004000000-row0002";
        let error;
        try { await ensureSelfIdentity(state.plugin, settings); } catch (cause) { error = cause; }
        assert(error?.message.includes("不一致") && state.writes.length === 0, "失配本人被当作已完成");
        state.files.delete(SELF_IDENTITY_STORAGE_KEY);
        state.rows.push(state.row("20261004000000-other01", "20261004000000-row0003"));
        invalidateRoster();
        error = undefined;
        try { await ensureSelfIdentity(state.plugin, settings); } catch (cause) { error = cause; }
        assert(error?.message.includes("多个同名") && state.writes.length === 0 && state.kernelWrites.length === 0, "同名多候选被取首个");
    });
    await test("AG-B11-001 本人迁移原文档 ID 映射目标行，预览零写入与重复恢复幂等", async () => {
        const state = configureSelfKernel(kernel, settings);
        state.files.set(SELF_IDENTITY_STORAGE_KEY, identity);
        const exported = await exportMigrationBundle(state.plugin);
        const parsed = JSON.parse(exported);
        assert(parsed.modules.selfIdentity.identity.selfDocId === identity.selfDocId, "导出遗漏本人身份");
        const targetItemId = "20261004000000-row0002";
        state.rows[0].id = targetItemId;
        state.map[identity.selfDocId] = targetItemId;
        state.files.delete(SELF_IDENTITY_STORAGE_KEY);
        const preview = previewMigrationImport(identityBundle());
        assert(preview[0].key === "selfIdentity" && preview[0].count === 1 && state.writes.length === 0, "预览遗漏本人或写入");
        const report = await importMigrationBundle(state.plugin, identityBundle());
        assert(report.failed.length === 0 && report.issues.length === 0 && (await loadSelfIdentity(state.plugin)).selfItemId === targetItemId, "恢复使用了源行 ID");
        const repeated = await importMigrationBundle(state.plugin, identityBundle());
        assert(state.writes.length === 1 && repeated.modules[0].skipped === 1, "重复本人恢复重写");
    });
    await test("AG-B11-001 本人恢复冲突、空模块与同名其他文档，保留当前事实", async () => {
        const state = configureSelfKernel(kernel, settings);
        const current = { ...identity, selfDocId: "20261004000000-other01" };
        state.files.set(SELF_IDENTITY_STORAGE_KEY, current);
        const conflict = await importMigrationBundle(state.plugin, identityBundle());
        assert(conflict.issues[0].reason === "conflict" && conflict.retryBundle && state.writes.length === 0, "不同本人冲突被覆盖或未保留重试包");
        await importMigrationBundle(state.plugin, identityBundle(null));
        assert((await loadSelfIdentity(state.plugin)).selfDocId === current.selfDocId, "空模块清除了当前本人");
        state.files.delete(SELF_IDENTITY_STORAGE_KEY);
        state.rows = [state.row(current.selfDocId)];
        state.map = {};
        const unreachable = await importMigrationBundle(state.plugin, identityBundle());
        assert(unreachable.issues[0].reason === "unreachable" && state.writes.length === 0, "同名另一文档替代了原本人");
        state.rows = [state.row()];
        state.map = { [identity.selfDocId]: identity.selfItemId };
        state.docPresent = false;
        const deleted = await importMigrationBundle(state.plugin, identityBundle());
        assert(deleted.issues[0].reason === "unreachable" && state.writes.length === 0, "AV 悬空绑定被当作可达本人");
    });
    await test("AG-B11-001 本人恢复写后回读未知，只核实原身份不重复写入", async () => {
        const state = configureSelfKernel(kernel, settings);
        state.loseBindingAfterSave = true;
        const unknown = await importMigrationBundle(state.plugin, identityBundle());
        assert(unknown.failed[0].status === "unknown" && unknown.retryBundle && state.writes.length === 1, "写后未知被当作失败或完成");
        state.loseBindingAfterSave = false;
        const retry = await importMigrationBundle(state.plugin, unknown.retryBundle);
        assert(retry.failed.length === 0 && state.writes.length === 1, "已存本人重试重复写入");
    });
    await test("AG-B11-001 坏本人禁止导出与名册假成功，绑定存储修复后可读取", async () => {
        const state = configureSelfKernel(kernel, settings);
        state.files.set(SELF_IDENTITY_STORAGE_KEY, { schemaVersion: 9 });
        bindSelfIdentityStorage(state.plugin);
        try {
            let exportError;
            let rosterError;
            try { await exportMigrationBundle(state.plugin); } catch (cause) { exportError = cause; }
            invalidateRoster();
            try { await getRoster(settings); } catch (cause) { rosterError = cause; }
            assert(exportError && rosterError && state.writes.length === 0, "坏身份被吞掉或导出空成功包");
            state.files.set(SELF_IDENTITY_STORAGE_KEY, identity);
            invalidateRoster();
            assert((await getRoster(settings))[0].isSelf === true, "修复后名册未恢复本人标记");
        } finally {
            state.files.delete(SELF_IDENTITY_STORAGE_KEY);
            invalidateRoster();
        }
    });
}
