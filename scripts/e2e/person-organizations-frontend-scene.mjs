/** Production PersonEdit -> organization creation -> JSON/service readback in the owned Kernel. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertIsolatedPath } from "./kernel-safety.mjs";

const json = JSON.stringify;
export async function verifyPersonOrganizationsScene({ browserSession, first, organizations, deadline, evidence, workspace, request, settings }) {
    const result = evidence.personOrganizations = { actualProductionUi: true, actualKernel: true, trustedCriticalClicks: [], multiSelected: false,
        independentFields: false, cancellationPreservedDraft: false, createdNameEntered: false, createdIdentitySelected: false,
        serviceAndJsonVerified: false, editorReopened: false, newDocumentVerified: false, persistedAfterReload: false, completed: false,
        partialProfileRecoveryExercised: false, responsiveWidths: [] };
    const wait = async (check, label) => {
        while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 150)); }
        throw new Error(`真实多组织场景超时：${label}`);
    };
    const exists = selector => browserSession.evaluate(`!!document.querySelector(${json(selector)})`);
    const click = async (selector, label) => {
        await wait(async () => Boolean(await browserSession.evaluate(`(()=>{const node=document.querySelector(${json(selector)});return node&&!node.disabled})()`)), `${label}就绪`);
        await browserSession.evaluate("Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{})))");
        const point = await browserSession.evaluate(`(async()=>{const node=document.querySelector(${json(selector)});if(!node||node.disabled)return null;const panel=node.closest('.lvct-dialog-panel');for(let parent=panel?.parentElement?.closest('.lvct-dialog-panel');parent;parent=parent.parentElement?.closest('.lvct-dialog-panel'))parent.scrollTop=0;node.scrollIntoView({behavior:'instant',block:'center',inline:'nearest',container:'nearest'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(!r.width||!r.height||!node.contains(document.elementFromPoint(x,y)))return {blocked:true,tag:document.elementFromPoint(x,y)?.className,x,y,rect:{top:r.top,left:r.left,width:r.width,height:r.height},panels:[...document.querySelectorAll('.lvct-dialog-panel,.lvct-dialog-mask')].map(p=>({class:p.className,scroll:p.scrollTop,rect:{top:p.getBoundingClientRect().top,height:p.getBoundingClientRect().height,width:p.getBoundingClientRect().width}}))};window.__lvctOrgClick=null;document.addEventListener('click',event=>window.__lvctOrgClick={trusted:event.isTrusted,matched:node.contains(event.target)}, {once:true,capture:true});return {x,y}})()`);
        assert.ok(point && !point.blocked, `${label}不可点击：${JSON.stringify(point)}`);
        await browserSession.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
        await browserSession.call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
        await browserSession.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
        const observed = await browserSession.evaluate("window.__lvctOrgClick");
        assert.equal(observed?.trusted, true, `${label}未产生可信点击`); assert.equal(observed?.matched, true, `${label}点击未命中`);
        result.trustedCriticalClicks.push({ label, ...observed });
    };
    const input = async (selector, value) => {
        assert.equal(await browserSession.evaluate(`(()=>{const node=document.querySelector(${json(selector)});if(!node||node.disabled||!node.getClientRects().length)return false;const proto=node instanceof HTMLSelectElement?HTMLSelectElement.prototype:node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(node,${json(value)});node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));return node.value===${json(value)}})()`), true, `填写失败 ${selector}`);
    };
    const labelInput = async (docId, label, value) => {
        const token = `lvct-org-input-${randomUUID()}`;
        const marked = await browserSession.evaluate(`(()=>{const card=document.querySelector('.lvct-person-edit__org-draft[data-org-doc-id="${docId}"]');const row=[...card.querySelectorAll('label')].find(node=>node.querySelector('span')?.textContent?.trim()===${json(label)});const control=row?.querySelector('input,select');if(!control)return null;control.setAttribute('data-ui-org-control',${json(token)});const details=control.closest('details');if(details&&!details.open){details.querySelector('summary').setAttribute('data-ui-org-summary',${json(token)});return {expand:true}}return {expand:false}})()`);
        assert.ok(marked, `找不到${label}`);
        if (marked.expand) await click(`[data-ui-org-summary="${token}"]`, `展开${label}更多设置`);
        await input(`[data-ui-org-control="${token}"]`, value);
    };
    const markButton = async (scope, text, token) => {
        assert.equal(await browserSession.evaluate(`(()=>{const node=[...document.querySelectorAll(${json(scope + " button")})].find(node=>node.textContent?.trim()===${json(text)});if(!node||node.disabled)return false;node.setAttribute('data-ui-org-button',${json(token)});return true})()`), true, `找不到${text}`);
        return `[data-ui-org-button="${token}"]`;
    };
    const artifactDir = path.resolve(process.env.LVCT_E2E_ARTIFACT_DIR || path.join(workspace, "person-organizations-ui-artifacts"));
    assertIsolatedPath(workspace, artifactDir); fs.mkdirSync(artifactDir, { recursive: true });
    const shot = async (name, selector) => {
        await browserSession.evaluate("Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{})))");
        if (selector) await browserSession.evaluate(`(()=>{const node=document.querySelector(${json(selector)});const panel=node?.closest('.lvct-dialog-panel');if(!node||!panel)return;for(const ancestor of document.querySelectorAll('.lvct-dialog-panel,.lvct-dialog-mask'))ancestor.scrollTop=0;const rect=node.getBoundingClientRect(),frame=panel.getBoundingClientRect();panel.scrollTop=Math.max(0,rect.top-frame.top-64)})()`);
        await browserSession.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        const data = await browserSession.call("Page.captureScreenshot", { format: "png" });
        const target = path.join(artifactDir, `${name}.png`); fs.writeFileSync(target, Buffer.from(data.data, "base64")); evidence.screenshots.push(target);
    };
    const openEditor = async () => {
        await wait(async () => Boolean(await browserSession.evaluate("!document.querySelector('.lvct-detail__header-actions button:first-child')?.disabled")), "人物编辑入口就绪");
        await click(".lvct-detail__header-actions button:first-child", "编辑人物资料");
        await wait(() => exists('.lvct-person-edit__profile .lvct-org-multi__trigger:not([disabled])'), "多选编辑器打开");
    };
    const snapshot = () => browserSession.evaluate(`(()=>({relation:document.querySelector('.lvct-person-edit__profile input[maxlength="1600"]')?.value,cards:[...document.querySelectorAll('.lvct-person-edit__org-draft')].map(node=>({docId:node.dataset.orgDocId,fields:[...node.querySelectorAll('input,select')].map(node=>node.value)}))}))()`);
    const closeEditor = async () => {
        await click(".lvct-person-edit__profile + .lvct-form__grid ~ .lvct-form__actions button:last-child", "保存并关闭人物编辑");
        await wait(async () => !await exists(".lvct-person-edit__profile"), "人物编辑关闭");
    };
    const hostStorage = path.join(workspace, "data/storage/petal/siyuan-contacts");
    const adapter = { async loadData(name) { assert.match(name, /^[a-z0-9-]+\.json$/); const target = path.join(hostStorage, name); assertIsolatedPath(workspace, target); return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : null; } };
    const verifyFacts = async (created, expected) => {
        const { loadOrgMembershipStore } = await import("../../src/data/org-membership.ts");
        const { listPersonOrgMemberships, getOrganizationProfile, invalidateOrganizationScan } = await import("../../src/services/org.ts");
        invalidateOrganizationScan();
        const store = await loadOrgMembershipStore(adapter);
        const rows = store.memberships.filter(item => item.personDocId === first.docId);
        assert.equal(rows.length, 3, "同一人物应有三段独立经历且不重复");
        for (const input of expected) {
            const actual = rows.find(item => item.orgDocId === input.docId); assert.ok(actual, `缺少${input.docId}`);
            for (const key of ["department", "title", "joinedOn", "leftOn", "status", "statusLabel", "affiliationKind", "note"]) assert.equal(actual[key] ?? "", input[key] ?? "", `独立资料未保持 ${input.docId} ${key}`);
        }
        const service = await listPersonOrgMemberships(adapter, first.docId);
        assert.equal(service.length, 3); assert.ok(service.every(item => !item.removed && item.reachable !== false));
        const profile = await getOrganizationProfile(adapter, created.docId); assert.equal(profile?.name, created.name);
        const envelope = await request("/api/query/sql", { stmt: `SELECT id,content,ial FROM blocks WHERE root_id='${created.docId}' ORDER BY id LIMIT 33` });
        assert.equal(envelope.code, 0); assert.ok(envelope.data.some(row => row.id === created.docId && row.content === created.name));
        assert.ok(envelope.data.some(row => row.ial?.includes('custom-lvct-org="1"')));
        return { memberships: rows, service, profile, organizationRows: envelope.data };
    };
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    await openEditor();
    await click('.lvct-org-multi__trigger', "打开组织多选");
    for (const organization of organizations) {
        await click(`.lvct-org-multi__option input[aria-label="${organization.name}"]`, `勾选${organization.name}`);
        await wait(() => exists(`.lvct-person-edit__org-draft[data-org-doc-id="${organization.docId}"]`), "选中组织独立草稿");
    }
    await shot("person-organizations-desktop-multi-picker");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await wait(async () => !await exists('.lvct-org-multi__panel'), "缩窄后组织浮层关闭");
    await click('.lvct-org-multi__trigger', "390宽度打开组织多选");
    await shot("person-organizations-390px-multi-picker");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    await wait(async () => !await exists('.lvct-org-multi__panel'), "恢复桌面后组织浮层关闭");
    await click('.lvct-org-multi__trigger', "桌面重新打开组织多选");
    await click(await markButton('.lvct-org-multi__panel', "完成选择", "done"), "完成组织多选");
    result.multiSelected = true;
    await shot("person-organizations-desktop-compact-two-cards", ".lvct-person-edit__profile");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await shot("person-organizations-390px-compact-two-cards", ".lvct-person-edit__profile");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    const expected = [
        { docId: organizations[0].docId, affiliationKind: "work", status: "active", department: "虚构研发部", title: "虚构工程师", joinedOn: "2024-01-15", leftOn: "", statusLabel: "兼职", note: "第一段独立备注" },
        { docId: organizations[1].docId, affiliationKind: "education", status: "former", department: "虚构计算机系", title: "虚构校友", joinedOn: "2020-09-01", leftOn: "2024-06-30", statusLabel: "已毕业", note: "第二段独立备注" },
    ];
    for (const item of expected) for (const [label, key] of [["归属分类", "affiliationKind"], ["当前状态", "status"], ["部门/院系", "department"], ["职位/身份", "title"], ["开始日期", "joinedOn"], ["自定义状态", "statusLabel"], ["成员备注", "note"], ...(item.leftOn ? [["结束日期", "leftOn"]] : [])]) await labelInput(item.docId, label, item[key]);
    result.independentFields = true;
    await shot("person-organizations-desktop-multi-drafts", ".lvct-person-edit__profile");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await shot("person-organizations-390px-multi-drafts", ".lvct-person-edit__profile"); result.responsiveWidths.push(390, 1365);
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    const beforeCancel = await snapshot();
    await click('.lvct-org-multi__summary button', "从已有组织旁直接新建");
    await wait(() => exists('.lvct-org-profile-editor input[aria-label="组织名称（必填）"]'), "真名称表单");
    await input('.lvct-org-profile-editor input[aria-label="组织名称（必填）"]', "虚构取消组织不可落库");
    await shot("person-organizations-desktop-create-name", ".lvct-org-profile-editor");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await shot("person-organizations-390px-create-name", ".lvct-org-profile-editor");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    await click('.lvct-org-profile-editor__intro button', "取消组织创建");
    await wait(() => exists('.lvct-closeguard [data-choice="discard"]'), "新组织放弃守卫");
    await click('.lvct-closeguard [data-choice="discard"]', "放弃组织创建草稿");
    await wait(async () => !await exists('.lvct-org-profile-editor'), "返回人物编辑");
    await wait(() => exists('.lvct-org-multi__summary button:not([disabled])'), "取消后人物候选刷新完成");
    assert.deepEqual(await snapshot(), beforeCancel, "取消新建丢失或覆盖人物未保存草稿"); result.cancellationPreservedDraft = true;
    await click('.lvct-org-multi__summary button', "再次真新建组织");
    await wait(() => exists('.lvct-org-profile-editor input[aria-label="组织名称（必填）"]'), "第二次真名称表单");
    const newName = `虚构新建第三组织${randomUUID().slice(0, 8)}`;
    await input('.lvct-org-profile-editor input[aria-label="组织名称（必填）"]', newName); result.createdNameEntered = true;
    await click('.lvct-org-profile-editor__footer .b3-button--primary', "保存新组织名称与资料");
    await wait(async () => !await exists('.lvct-org-profile-editor') && (await browserSession.evaluate("document.querySelectorAll('.lvct-person-edit__org-draft').length")) === 3, "新组织自动选中");
    const created = await browserSession.evaluate(`(()=>{const node=[...document.querySelectorAll('.lvct-person-edit__org-draft')].find(node=>node.querySelector('strong')?.textContent?.trim()===${json(newName)});return node?{docId:node.dataset.orgDocId,name:node.querySelector('strong')?.textContent?.trim()}:null})()`);
    await wait(() => exists('.lvct-org-multi__summary button:not([disabled])'), "新建后组织候选与焦点恢复完成");
    assert.match(created?.docId ?? "", /^\d{14}-[a-z0-9]{7}$/); result.created = created; result.createdIdentitySelected = true;
    assert.deepEqual((await snapshot()).cards.slice(0, 2), beforeCancel.cards, "创建后原组织草稿被重置");
    const third = { docId: created.docId, affiliationKind: "unspecified", status: "active", department: "虚构志愿组", title: "虚构成员", joinedOn: "2026-10-01", leftOn: "", statusLabel: "志愿者", note: "第三段新建组织备注" };
    expected.push(third);
    for (const [label, key] of [["归属分类", "affiliationKind"], ["部门/院系", "department"], ["职位/身份", "title"], ["开始日期", "joinedOn"], ["自定义状态", "statusLabel"], ["成员备注", "note"]]) await labelInput(created.docId, label, third[key]);
    await click(await markButton('.lvct-person-edit__profile', "保存组织与称谓", "save-profile"), "保存三段组织经历");
    await wait(async () => (await browserSession.evaluate("document.querySelectorAll('.lvct-person-edit__org-list .lvct-person-edit__org-item').length")) === 3 && !await exists('.lvct-person-edit__org-draft'), "三段经历保存回读");
    result.savedFact = await verifyFacts(created, expected); result.serviceAndJsonVerified = true;
    await shot("person-organizations-desktop-saved-memberships", ".lvct-person-edit__org-list");
    await closeEditor(); await openEditor();
    await wait(async () => (await browserSession.evaluate("document.querySelectorAll('.lvct-person-edit__org-list .lvct-person-edit__org-item').length")) === 3, "人物重开三段经历");
    result.editorReopened = true;
    await shot("person-organizations-desktop-reopened", ".lvct-person-edit__org-list");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await shot("person-organizations-390px-reopened", ".lvct-person-edit__org-list");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    await closeEditor();
    const nonce = randomUUID(); await browserSession.evaluate(`window.__lvctOrgReloadNonce=${json(nonce)}`);
    await browserSession.call("Page.reload", { ignoreCache: true });
    await wait(async () => Boolean(await browserSession.evaluate(`window.__lvctOrgReloadNonce!==${json(nonce)}&&window.LvContacts?.protocol===2`).catch(() => false)), "真实新document重载"); result.newDocumentVerified = true;
    assert.equal(await browserSession.evaluate("(()=>{const node=[...document.querySelectorAll('[title],[aria-label],button,.b3-tooltips')].find(node=>/小驴人脉|Lv Contacts/.test(node.getAttribute('title')||node.getAttribute('aria-label')||node.textContent||''));if(!node)return false;node.click();return true})()"), true);
    await wait(() => exists('[data-navigation-view="people"]'), "重载工作台"); await browserSession.evaluate("document.querySelector('[data-navigation-view=people]').click()");
    await wait(() => exists(`[data-person-item-id="${first.itemId}"]`), "重载人物入口"); await click(`[data-person-item-id="${first.itemId}"]`, "重载后人物详情");
    await wait(() => exists('.lvct-detail'), "重载人物详情"); await openEditor();
    await wait(async () => (await browserSession.evaluate("document.querySelectorAll('.lvct-person-edit__org-list .lvct-person-edit__org-item').length")) === 3, "重载经历持久化");
    result.reloadedFact = await verifyFacts(created, expected); result.persistedAfterReload = true;
    await closeEditor();
    await click('.lvct-detail > .lvct-form__actions button:first-child', "关闭已有联系人详情");
    await wait(async () => !await exists('.lvct-detail'), "已有详情关闭");

    const creation = result.addPerson = { multiSelected: false, sameOrganizationHistory: false, saved: false, serviceAndJsonVerified: false, name: `虚构新建多组织人物${randomUUID().slice(0, 8)}` };
    await click('.lvct-people__create', "从联系人页新建人物");
    await wait(() => exists('#lvct-contact-name'), "新建人物表单打开");
    await input('#lvct-contact-name', creation.name);
    await click('#lvct-contact-extra-toggle', "新人物展开补充资料");
    await wait(() => exists('.lvct-add-person__org-selector .lvct-org-multi__trigger:not([disabled])'), "新人物组织候选就绪");
    await click('.lvct-add-person__org-selector .lvct-org-multi__trigger', "新人物统一组织多选");
    for (const organization of organizations) await click(`.lvct-org-multi__option input[aria-label="${organization.name}"]`, `新人物选择${organization.name}`);
    await click(await markButton('.lvct-org-multi__panel', "完成选择", "add-done"), "新人物完成组织选择");
    await wait(async () => (await browserSession.evaluate("document.querySelectorAll('.lvct-add-person__org-draft').length")) === 2, "新人物两组织独立卡片");
    creation.multiSelected = true;
    await shot("add-person-organizations-desktop-compact-two-cards", ".lvct-add-person__org-selector");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await shot("add-person-organizations-390px-compact-two-cards", ".lvct-add-person__org-selector");
    await browserSession.call("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    const addCard = docId => `.lvct-add-person__org-draft[data-org-doc-id="${docId}"]`;
    const addField = async (cardSelector, label, value) => {
        const token = `lvct-add-org-${randomUUID()}`;
        const marked = await browserSession.evaluate(`(()=>{const card=document.querySelector(${json(cardSelector)});const row=[...card.querySelectorAll('label')].find(node=>node.querySelector('span')?.textContent?.trim()===${json(label)});const node=row?.querySelector('input,select');if(!node)return null;node.setAttribute('data-ui-org-control',${json(token)});const details=node.closest('details');if(details&&!details.open){details.querySelector('summary').setAttribute('data-ui-org-summary',${json(token)});return {expand:true}}return {expand:false}})()`);
        assert.ok(marked, `新人物缺少${label}`);
        if (marked.expand) await click(`[data-ui-org-summary="${token}"]`, `新人物展开${label}更多设置`);
        await input(`[data-ui-org-control="${token}"]`, value);
    };
    const newExpected = [
        { orgDocId: organizations[0].docId, affiliationKind: "work", status: "active", department: "新建研发部", title: "新建工程师", joinedOn: "2024-02-01", leftOn: "", statusLabel: "兼职", note: "新人物当前经历" },
        { orgDocId: organizations[1].docId, affiliationKind: "education", status: "former", department: "新建信息系", title: "新建校友", joinedOn: "2018-09-01", leftOn: "2022-06-30", statusLabel: "毕业", note: "新人物学校经历" },
    ];
    const fillAdd = async (selector, entry) => {
        for (const [label, key] of [["归属分类", "affiliationKind"], ["当前状态", "status"], ["部门/院系", "department"], ["职位/身份", "title"], ["开始日期", "joinedOn"], ["自定义状态", "statusLabel"], ["成员备注", "note"], ...(entry.leftOn ? [["结束日期", "leftOn"]] : [])]) await addField(selector, label, entry[key]);
    };
    for (const entry of newExpected) await fillAdd(addCard(entry.orgDocId), entry);
    await click(await markButton(addCard(organizations[0].docId), "补录历史", "add-history"), "新人物同组织补录历史");
    await wait(async () => (await browserSession.evaluate(`document.querySelectorAll('${addCard(organizations[0].docId)}').length`)) === 2, "新人物同组织历史独立卡");
    const historicalKey = await browserSession.evaluate(`document.querySelectorAll('${addCard(organizations[0].docId)}')[1].dataset.entryId`);
    const history = { orgDocId: organizations[0].docId, affiliationKind: "work", status: "former", department: "原实习部门", title: "原实习生", joinedOn: "2021-07-01", leftOn: "2021-09-01", statusLabel: "实习结束", note: "新人物同组织历史独立段" };
    newExpected.push(history); await fillAdd(`.lvct-add-person__org-draft[data-entry-id="${historicalKey}"]`, history); creation.sameOrganizationHistory = true;
    await shot("add-person-organizations-desktop-three-periods", ".lvct-add-person__org-selector");
    await click('#lvct-contact-name', "确认新人物姓名与提交范围");
    const addSaveSelector = await browserSession.evaluate("(()=>{const root=document.querySelector('#lvct-contact-name').closest('.lvct-form');const node=root.querySelector(':scope > .lvct-form__actions .b3-button--primary');if(!node)return null;node.setAttribute('data-ui-org-button','add-submit');return '[data-ui-org-button=add-submit]'})()");
    assert.ok(addSaveSelector); await click(addSaveSelector, "创建新人物并保存三段经历");
    await wait(async () => !await exists('#lvct-contact-name'), "新人物创建完成"); creation.saved = true;
    const { listContacts } = await import("../../src/services/contacts.ts");
    const { invalidateRoster } = await import("../../src/services/roster.ts");
    const { loadOrgMembershipStore } = await import("../../src/data/org-membership.ts");
    const { listPersonOrgMemberships, invalidateOrganizationScan } = await import("../../src/services/org.ts");
    invalidateRoster(); invalidateOrganizationScan();
    const matching = (await listContacts(settings)).filter(person => person.name === creation.name);
    assert.equal(matching.length, 1, "新人物应创建一个稳定身份"); creation.person = { docId: matching[0].docId, itemId: matching[0].itemId, name: matching[0].name };
    const savedStore = await loadOrgMembershipStore(adapter);
    const savedRows = savedStore.memberships.filter(entry => entry.personDocId === creation.person.docId);
    assert.equal(savedRows.length, 3); assert.equal(new Set(savedRows.map(entry => entry.id)).size, 3);
    for (const expectedRow of newExpected) {
        const actual = savedRows.find(entry => entry.orgDocId === expectedRow.orgDocId && entry.status === expectedRow.status);
        assert.ok(actual, "新人物缺少独立经历");
        for (const [key, value] of Object.entries(expectedRow)) assert.equal(actual[key] ?? "", value, `新人物经历未保持 ${key}`);
    }
    const serviceRows = await listPersonOrgMemberships(adapter, creation.person.docId); assert.equal(serviceRows.length, 3);
    assert.ok(serviceRows.every(entry => entry.reachable !== false && !entry.removed));
    creation.savedFact = { memberships: savedRows, service: serviceRows }; creation.serviceAndJsonVerified = true;
    await wait(() => exists(`[data-person-item-id="${creation.person.itemId}"]`), "新人物名册入口");
    await click(`[data-person-item-id="${creation.person.itemId}"]`, "新人物保存后打开详情");
    await wait(() => exists('.lvct-detail'), "新人物详情回读"); await openEditor();
    await wait(async () => (await browserSession.evaluate("document.querySelectorAll('.lvct-person-edit__org-list .lvct-person-edit__org-item').length")) === 3, "新人物编辑重开三段经历");
    creation.editorReopened = true; await shot("add-person-organizations-desktop-reopened", ".lvct-person-edit__org-list");
    result.completed = true;
}
