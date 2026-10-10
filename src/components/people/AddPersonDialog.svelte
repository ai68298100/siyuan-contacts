<script lang="ts">
    /** 新建联系人弹窗 */
    import { ContactCreationError, ContactNameAmbiguityError, createContact } from "../../services/contacts";
    import type { ContactCreationPreview, ContactCreationRequest } from "../../services/contacts";
    import { emptyDraft } from "../../domain/person";
    import type { ContactDraft, ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";
    import QuickFillDialog from "./QuickFillDialog.svelte";
    import GroupField from "./GroupField.svelte";
    import BirthdayField from "./BirthdayField.svelte";
    import { ClipboardPaste } from "@lucide/svelte";
    import type { ContactExtendedDraft, ContactOrgAffiliationDraft } from "../../domain/contact-create";
    import { validateContactExtendedDraft } from "../../domain/contact-create";
    import type { SelfIdentity, SelfIdentityChangePreview } from "../../domain/self-identity";

    let {
        settings,
        i18n,
        initial,
        hostCloseChannel,
        onLoadOrgCandidates,
        onCreateOrganization,
        onValidateExtended,
        onCreateSelfProfile,
        onLoadSelfCandidates,
        onPreviewSelfIdentityChange,
        onApplySelfIdentityChange,
        onSaveExtended,
        onCreated,
        onClose,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        /** FAST-01.3：识别资料后预填的初始草稿（打开快照，不随外部变化） */
        initial?: ContactDraft;
        /** D-40：libs/dialog 注入的宿主关闭通道（X/Esc/遮罩经守卫路由）；缺省保持宿主原行为 */
        hostCloseChannel?: { request?: (close: () => void) => void };
        /** 新建后可选的扩展资料保存回调（组织、与我的关系、人物备注）。 */
        onLoadOrgCandidates?: () => Promise<ReadonlyArray<{ docId: string; name: string; archived?: boolean }>>;
        /** 当前没有合适组织时，跳转到统一的新建组织页面。 */
        onCreateOrganization?: () => void | Promise<void>;
        /** 创建文档前核验已填写的补充资料是否满足前置条件。 */
        onValidateExtended?: (details: ContactExtendedDraft) => Promise<void>;
        /** 关系称谓缺少本人档案时，在当前草稿中完成本人档案设置。 */
        onCreateSelfProfile?: () => Promise<SelfIdentity | null>;
        onLoadSelfCandidates?: () => Promise<ContactSummary[]>;
        onPreviewSelfIdentityChange?: (personItemId: string) => Promise<SelfIdentityChangePreview>;
        onApplySelfIdentityChange?: (preview: SelfIdentityChangePreview) => Promise<SelfIdentity | null>;
        onSaveExtended?: (person: ContactSummary, details: ContactExtendedDraft) => Promise<void>;
        onCreated: (person: ContactSummary) => void;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    // svelte-ignore state_referenced_locally
    let draft: ContactDraft = $state(initial ? { ...initial, tags: [...initial.tags] } : emptyDraft());
    // svelte-ignore state_referenced_locally
    let tagsText: string = $state(initial ? initial.tags.join(" ") : "");
    let running: boolean = $state(false);
    let groupValid = $state(true);
    let errorText: string = $state("");
    let saved = $state(false);
    let creationPreview = $state<ContactCreationPreview | null>(null);
    let creationChoice = $state("");
    let creationRequest = $state<ContactCreationRequest | undefined>();
    /** 创建文档成功但补充资料保存失败时，重试只补写资料，避免再次创建同名联系人。 */
    let createdPerson = $state<ContactSummary | null>(null);
    let extraOpen = $state(false);
    let extraLoading = $state(false);
    let extraError = $state("");
    let creatingOrganization = $state(false);
    let orgCandidates = $state<ReadonlyArray<{ docId: string; name: string; archived?: boolean }>>([]);
    let orgAffiliations = $state<ContactOrgAffiliationDraft[]>([]);
    let aliases = $state("");
    let relationshipLabels = $state("");
    let note = $state("");
    let selfSetupOpen = $state(false);
    let selfSetupBusy = $state(false);
    let selfSetupError = $state("");
    let selfSetupNotice = $state("");
    let selfCandidates = $state<ContactSummary[]>([]);
    let selfCandidateItemId = $state("");
    let selfPreview = $state<SelfIdentityChangePreview | null>(null);
    const extendedSupported = $derived(Boolean(onSaveExtended));
    const currentPreview = $derived(creationPreview?.name === draft.name.trim() ? creationPreview : null);
    function emptyOrgAffiliation(): ContactOrgAffiliationDraft {
        return { orgDocId: "", orgDepartment: "", orgTitle: "", orgJoinedOn: "", orgLeftOn: "", orgStatus: "active", orgStatusLabel: "", orgAffiliationKind: "unspecified", orgNote: "" };
    }
    function patchOrgAffiliation(index: number, patch: Partial<ContactOrgAffiliationDraft>): void {
        orgAffiliations = orgAffiliations.map((entry, current) => {
            if (current !== index) return entry;
            const updated = { ...entry, ...patch };
            const organization = orgCandidates.find((org) => org.docId === updated.orgDocId);
            if (organization?.archived) updated.orgStatus = "former";
            if (organization?.name.trim() === "家庭") updated.orgAffiliationKind = "family";
            if (updated.orgStatus === "active") updated.orgLeftOn = "";
            return updated;
        });
    }
    function changeOrgStatus(index: number, status: ContactOrgAffiliationDraft["orgStatus"]): void {
        orgAffiliations = orgAffiliations.map((entry, current) => current === index
            ? { ...entry, orgStatus: status, orgLeftOn: status === "active" ? "" : entry.orgLeftOn } : entry);
    }
    // FAST-01.1：粘贴并识别（识别结果经勾选后回填草稿，不直接写库）
    let quickFillOpen = $state(false);
    function applyQuickFill(patch: {
        name?: string; phone?: string; email?: string; wechat?: string;
        website?: string; birthday?: string; isLunar?: boolean; group?: string;
        tagsAppend: string[];
    }) {
        if (patch.name !== undefined) draft.name = patch.name;
        if (patch.phone !== undefined) draft.phone = patch.phone;
        if (patch.email !== undefined) draft.email = patch.email;
        if (patch.wechat !== undefined) draft.wechat = patch.wechat;
        if (patch.website !== undefined) draft.website = patch.website;
        if (patch.birthday !== undefined) draft.birthday = patch.birthday;
        if (patch.isLunar !== undefined) draft.isLunar = patch.isLunar;
        if (patch.group !== undefined) draft.group = patch.group;
        if (patch.tagsAppend.length) {
            const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter(Boolean);
            for (const tag of patch.tagsAppend) if (!tags.includes(tag)) tags.push(tag);
            tagsText = tags.join(" ");
        }
    }
    // B06：新建草稿给出明细 + 「保存并离开」（persist 抛错则留在原地）
    async function persist(): Promise<void> {
        if (!groupValid) throw new Error(text("groupCustomEmpty", "请输入分组名称。"));
        const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        running = true;
        try {
            const firstOrg = orgAffiliations.find((entry) => entry.orgDocId) ?? emptyOrgAffiliation();
            const extendedDetails = { orgMemberships: orgAffiliations.filter((entry) => entry.orgDocId).map((entry) => ({ ...entry })),
                orgDocId: firstOrg.orgDocId, orgDepartment: firstOrg.orgDepartment, orgTitle: firstOrg.orgTitle,
                orgJoinedOn: firstOrg.orgJoinedOn, orgAffiliationKind: firstOrg.orgAffiliationKind, aliases, relationshipLabels, note };
            const affiliationErrors = validateContactExtendedDraft(extendedDetails);
            if (affiliationErrors.length) throw new Error(affiliationErrors.join("；"));
            if (!createdPerson && onValidateExtended) await onValidateExtended(extendedDetails);
            const person = createdPerson ?? await createContact(settings, { ...draft, tags }, {
                request: creationRequest,
                allowSameName: currentPreview !== null && creationChoice === "new",
                reuseDocId: currentPreview && creationChoice !== "new" ? creationChoice || undefined : undefined,
            });
            createdPerson = person;
            if (onSaveExtended) {
                try {
                    await onSaveExtended(person, extendedDetails);
                } catch (error) {
                    throw new Error(`联系人已创建，但补充资料保存失败：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            saved = true;
            onCreated(person);
        } catch (error) {
            if (error instanceof ContactNameAmbiguityError) {
                creationPreview = error.preview;
                creationChoice = "";
            }
            if (error instanceof ContactCreationError) creationRequest = error.request;
            throw error;
        } finally { running = false; }
    }
    async function openExtended(): Promise<void> {
        extraOpen = true;
        if (!onLoadOrgCandidates || extraLoading || orgCandidates.length > 0) return;
        extraLoading = true;
        extraError = "";
        try { orgCandidates = await onLoadOrgCandidates(); }
        catch (error) { extraError = error instanceof Error ? error.message : String(error); }
        finally { extraLoading = false; }
    }
    function toggleExtended(): void {
        if (extraOpen) {
            extraOpen = false;
            return;
        }
        void openExtended();
    }
    async function reloadOrgCandidates(): Promise<void> {
        orgCandidates = [];
        extraError = "";
        await openExtended();
    }
    async function openSelfSetup(): Promise<void> {
        selfSetupOpen = true;
        selfSetupError = "";
        selfSetupNotice = "";
        if (!onLoadSelfCandidates || selfCandidates.length > 0 || selfSetupBusy) return;
        selfSetupBusy = true;
        try { selfCandidates = await onLoadSelfCandidates(); }
        catch (error) { selfSetupError = error instanceof Error ? error.message : String(error); }
        finally { selfSetupBusy = false; }
    }
    async function createSelfProfileFromContact(): Promise<void> {
        if (!onCreateSelfProfile || selfSetupBusy) return;
        selfSetupBusy = true;
        selfSetupError = "";
        selfSetupNotice = "";
        try {
            const identity = await onCreateSelfProfile();
            if (!identity) throw new Error("本人档案未建立，请检查结果后重试");
            selfSetupOpen = false;
            selfSetupNotice = "本人档案已设置；当前联系人草稿已保留，请继续创建。";
            errorText = "";
        } catch (error) { selfSetupError = error instanceof Error ? error.message : String(error); }
        finally { selfSetupBusy = false; }
    }
    async function previewSelfCandidate(): Promise<void> {
        if (!onPreviewSelfIdentityChange || !selfCandidateItemId || selfSetupBusy || selfPreview) return;
        selfSetupBusy = true;
        selfSetupError = "";
        try { selfPreview = await onPreviewSelfIdentityChange(selfCandidateItemId); }
        catch (error) { selfSetupError = error instanceof Error ? error.message : String(error); }
        finally { selfSetupBusy = false; }
    }
    async function confirmSelfCandidate(): Promise<void> {
        if (!onApplySelfIdentityChange || !selfPreview || selfSetupBusy) return;
        selfSetupBusy = true;
        selfSetupError = "";
        try {
            const identity = await onApplySelfIdentityChange(selfPreview);
            if (!identity) throw new Error("本人身份未指定，请核实后重试");
            const targetName = selfPreview.target?.name ?? "所选联系人";
            selfPreview = null;
            selfSetupOpen = false;
            selfSetupNotice = `已将「${targetName}」设为本人；当前联系人草稿已保留，请继续创建。`;
            errorText = "";
        } catch (error) { selfSetupError = error instanceof Error ? error.message : String(error); }
        finally { selfSetupBusy = false; }
    }
    async function createOrganizationFromContact(): Promise<void> {
        if (!onCreateOrganization || creatingOrganization || running) return;
        creatingOrganization = true;
        extraError = "";
        try {
            await onCreateOrganization();
            await reloadOrgCandidates();
        } catch (error) {
            extraError = error instanceof Error ? error.message : String(error);
        } finally {
            creatingOrganization = false;
        }
    }
    function draftChanges(): string[] {
        if (saved) return [];
        const changes: string[] = [];
        const empty = text("guardEmpty", "（空）");
        const fields = [
            [text("formName", "姓名"), "name"], [text("formPhone", "电话"), "phone"],
            [text("formEmail", "邮箱"), "email"], [text("formWechat", "微信"), "wechat"],
            [text("formWebsite", "网站"), "website"], [text("formBirthday", "生日"), "birthday"],
            [text("formGroup", "分组"), "group"],
        ] as const;
        for (const [label, key] of fields) {
            if (String(draft[key]).trim().length > 0) {
                changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: label, from: empty, to: String(draft[key]) }));
            }
        }
        if (draft.isLunar) changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: text("formLunar", "农历生日"), from: empty, to: "✓" }));
        if (tagsText.trim().length > 0) changes.push(text("guardTagsChange", "标签：{from} → {to}", { from: empty, to: tagsText }));
        if (orgAffiliations.some((entry) => entry.orgDocId || entry.orgDepartment || entry.orgTitle || entry.orgJoinedOn || entry.orgLeftOn || entry.orgStatusLabel.trim() || entry.orgNote?.trim())) changes.push("组织归属补充资料已填写");
        if (relationshipLabels.trim()) changes.push("与我的关系称谓已填写");
        if (aliases.trim()) changes.push("别名/称呼已填写");
        if (note.trim()) changes.push("人物备注已填写");
        return changes;
    }
    const guardedClose = useCloseGuard({
        busy: () => running,
        dirty: () => !saved && (JSON.stringify(draft) !== JSON.stringify(emptyDraft()) || tagsText.trim().length > 0 || orgAffiliations.some((entry) => Boolean(entry.orgDocId || entry.orgDepartment || entry.orgTitle || entry.orgJoinedOn || entry.orgLeftOn || entry.orgStatusLabel.trim() || entry.orgNote?.trim())) || Boolean(aliases.trim() || relationshipLabels.trim() || note.trim())),
        changes: () => [...draftChanges(), ...(creationRequest ? [text("contactCheckpointWarning", "原请求断点仅保留在当前窗口。关闭不会删除已保存文档；请核实后继续，不能凭同名重新建档。")] : [])],
        save: persist,
    });
    /* D-40：宿主 X/Esc/遮罩经同一守卫路由（返回 Promise 供拦截层重入门） */
    $effect(() => {
        if (hostCloseChannel) hostCloseChannel.request = (close) => guardedClose(close);
    });

    /* D-35：错误出现时焦点迁入错误块（键盘/读屏用户可 Tab 继续操作） */
    let errorEl: HTMLElement | undefined = $state();
    $effect(() => {
        if (errorText && errorEl) errorEl.focus();
    });

    async function submit() {
        if (running) return;
        running = true;
        errorText = "";
        try {
            await persist();
            onClose();
        } catch (error) {
            errorText = error instanceof Error ? error.message : String(error);
            if (errorText.includes("请先在设置中指定“我”的档案")) void openSelfSetup();
        } finally {
            running = false;
        }
    }
</script>

<div class="lvct-form">
    <div class="lvct-form__toolbar">
        <button type="button" class="b3-button b3-button--text lvct-form__toolbar-btn" disabled={running || !!creationRequest} onclick={() => (quickFillOpen = true)}>
            <ClipboardPaste size={14}/>{text("qfOpen", "粘贴并识别")}
        </button>
    </div>
    <fieldset class="lvct-form__fields" disabled={running || !!creationRequest}>
    <label class="lvct-form__item">
        <span>{text("formName", "姓名")} <b class="ft__error">*</b></span>
        <input class="b3-text-field fn__block" type="text" bind:value={draft.name} placeholder={text("formNameHint", "联系人文档名将以此为题")} />
    </label>
    <div class="lvct-form__grid">
        <label class="lvct-form__item">
            <span>{text("formPhone", "电话")}</span>
            <input class="b3-text-field fn__block" type="tel" bind:value={draft.phone} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formWechat", "微信")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={draft.wechat} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formEmail", "邮箱")}</span>
            <input class="b3-text-field fn__block" type="email" bind:value={draft.email} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formWebsite", "网站")}</span>
            <input class="b3-text-field fn__block" type="url" bind:value={draft.website} placeholder="https://" />
        </label>
        <div class="lvct-form__item">
            <span>{text("formBirthday", "生日")}</span>
            <BirthdayField label={text("formBirthday", "生日")} value={draft.birthday} isLunar={draft.isLunar} onValueChange={(value) => (draft.birthday = value)} onModeChange={(isLunar) => (draft.isLunar = isLunar)} />
        </div>
        <GroupField {i18n} value={draft.group} onValueChange={(value) => (draft.group = value)} onValidityChange={(valid) => (groupValid = valid)} label={text("formGroup", "分组")} ungroupedLabel={text("formUngrouped", "未分组")} disabled={running || !!creationRequest} />
        <label class="lvct-form__item">
            <span>{text("formTagsLabel", "标签（空格/逗号分隔）")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={tagsText} placeholder={text("formTagsPlaceholder", "球友 重点")} />
        </label>
    </div>
    </fieldset>

    {#if extendedSupported}
        <section class="lvct-form__optional" aria-labelledby="lvct-contact-extra-toggle">
            <button id="lvct-contact-extra-toggle" type="button" class="b3-button b3-button--text lvct-form__optional-toggle" aria-expanded={extraOpen} aria-controls="lvct-contact-extra-body" onclick={toggleExtended} disabled={running || !!creationRequest}>
                {extraOpen ? "收起补充资料" : "补充资料（可选）"}
            </button>
            {#if extraOpen}
                <div id="lvct-contact-extra-body" class="lvct-form__optional-body">
                    <p id="lvct-contact-extra-title" class="ft__smaller ft__on-surface">姓名是唯一必填项；组织、关系和备注可在创建后继续修改。</p>
                    {#if onLoadOrgCandidates}
                        <div class="lvct-form__actions"><b>组织经历（可选，可添加多条）</b><button type="button" class="b3-button b3-button--outline" onclick={() => orgAffiliations = [...orgAffiliations, emptyOrgAffiliation()]} disabled={running || extraLoading}>添加组织经历</button></div>
                        {#each orgAffiliations as affiliation, index (index)}
                            <div class="lvct-form__grid lvct-person-edit__org-edit">
                                <label class="lvct-form__item"><span>组织</span><select class="b3-select fn__block" value={affiliation.orgDocId} onchange={(event) => patchOrgAffiliation(index, { orgDocId: event.currentTarget.value })} disabled={extraLoading || running || orgCandidates.length === 0}>
                                    <option value="">{extraLoading ? "读取组织中…" : "选择组织…"}</option>{#each orgCandidates as org (org.docId)}<option value={org.docId}>{org.name}{org.archived ? "（已归档，仅补录历史）" : ""}</option>{/each}
                                </select></label>
                                <label class="lvct-form__item"><span>归属分类</span><select class="b3-select fn__block" value={affiliation.orgAffiliationKind} onchange={(event) => patchOrgAffiliation(index, { orgAffiliationKind: event.currentTarget.value as ContactOrgAffiliationDraft["orgAffiliationKind"] })} disabled={running || !affiliation.orgDocId}>
                                    <option value="family">家庭</option><option value="unspecified">其他组织</option><option value="work">工作单位</option><option value="education">学校</option>
                                </select></label>
                                <label class="lvct-form__item"><span>状态</span><select class="b3-select fn__block" value={affiliation.orgStatus} onchange={(event) => changeOrgStatus(index, event.currentTarget.value as ContactOrgAffiliationDraft["orgStatus"])} disabled={running || !affiliation.orgDocId}>
                                    <option value="active" disabled={Boolean(orgCandidates.find((org) => org.docId === affiliation.orgDocId)?.archived)}>当前在职/就读</option><option value="former">已离开/毕业</option>
                                </select></label>
                                <label class="lvct-form__item"><span>自定义状态</span><input class="b3-text-field fn__block" maxlength="40" value={affiliation.orgStatusLabel} oninput={(event) => patchOrgAffiliation(index, { orgStatusLabel: event.currentTarget.value })} disabled={running || !affiliation.orgDocId} placeholder="例如：实习、兼职、休学" /></label>
                                <label class="lvct-form__item"><span>部门/院系</span><input class="b3-text-field fn__block" value={affiliation.orgDepartment} oninput={(event) => patchOrgAffiliation(index, { orgDepartment: event.currentTarget.value })} disabled={running || !affiliation.orgDocId} /></label>
                                <label class="lvct-form__item"><span>职位/身份</span><input class="b3-text-field fn__block" value={affiliation.orgTitle} oninput={(event) => patchOrgAffiliation(index, { orgTitle: event.currentTarget.value })} disabled={running || !affiliation.orgDocId} /></label>
                                <label class="lvct-form__item"><span>开始日期</span><input class="b3-text-field fn__block" type="date" value={affiliation.orgJoinedOn} oninput={(event) => patchOrgAffiliation(index, { orgJoinedOn: event.currentTarget.value })} disabled={running || !affiliation.orgDocId} /></label>
                                <label class="lvct-form__item"><span>结束日期</span><input class="b3-text-field fn__block" type="date" value={affiliation.orgLeftOn} oninput={(event) => patchOrgAffiliation(index, { orgLeftOn: event.currentTarget.value })} disabled={running || !affiliation.orgDocId || affiliation.orgStatus === "active"} /></label>
                                <label class="lvct-form__item"><span>成员备注</span><input class="b3-text-field fn__block" maxlength="240" value={affiliation.orgNote ?? ""} oninput={(event) => patchOrgAffiliation(index, { orgNote: event.currentTarget.value })} disabled={running || !affiliation.orgDocId} placeholder="仅记录这段组织经历" /></label>
                                <button type="button" class="b3-button b3-button--cancel" onclick={() => orgAffiliations = orgAffiliations.filter((_, row) => row !== index)} disabled={running}>移除这条</button>
                                {#if orgCandidates.find((org) => org.docId === affiliation.orgDocId)?.archived}<p class="ft__smaller ft__on-surface">组织已归档，只能登记为离开或毕业的历史经历。</p>{/if}
                            </div>
                        {/each}
                        {#if !extraLoading}
                            <span class="lvct-form__hint">{orgCandidates.length === 0 ? "暂无可选组织。" : "没有合适组织？"}{#if onCreateOrganization}<button type="button" class="b3-button b3-button--text lvct-form__inline-action" onclick={() => void createOrganizationFromContact()} disabled={running || creatingOrganization}>{creatingOrganization ? "组织创建中…" : "新建组织"}</button>{/if}<button type="button" class="b3-button b3-button--text lvct-form__inline-action" onclick={() => void reloadOrgCandidates()} disabled={running || creatingOrganization}>重新读取</button></span>
                        {/if}
                        {#if extraError}<p class="lvct-form__error" role="alert">组织读取失败：{extraError} <button type="button" class="b3-button b3-button--text" onclick={() => void openExtended()}>重试</button></p>{/if}
                    {/if}
                    <label class="lvct-form__item"><span>别名 / 常用称呼</span><input class="b3-text-field fn__block" maxlength="80" bind:value={aliases} disabled={running} placeholder="例如：张老师、英文名；多个称呼用顿号分隔" /></label>
                    <label class="lvct-form__item"><span>与我的关系称谓</span><input class="b3-text-field fn__block" maxlength="1600" bind:value={relationshipLabels} disabled={running} placeholder="例如：同事、朋友、校友；多个称谓用顿号分隔" /><small class="lvct-form__hint">需先在设置中指定“我”的档案；不填写无需设置。{#if onCreateSelfProfile}<button type="button" class="b3-button b3-button--text lvct-form__inline-action" onclick={() => void openSelfSetup()} disabled={running || selfSetupBusy}>设置本人档案</button>{/if}</small></label>
                    <label class="lvct-form__item"><span>人物备注</span><textarea class="b3-text-field fn__block" rows="3" maxlength="5000" bind:value={note} disabled={running} placeholder="记录你希望长期保留的补充信息"></textarea></label>
                </div>
            {/if}
        </section>
    {/if}

    {#if currentPreview && !creationRequest}
        <fieldset class="lvct-form__fields" disabled={running}>
            <legend>{text("contactSameNameReview", "同名候选，请核对人物身份")}</legend>
            {#each currentPreview.existing as person (person.docId)}
                <p class="ft__smaller">{person.name} · {person.phone || person.email || person.group || "—"}<br />{person.docId} · {person.itemId}</p>
            {/each}
            {#each currentPreview.unbound as doc (doc.docId)}
                <label class="lvct-form__item lvct-form__item--inline">
                    <input type="radio" name="lvct-contact-choice" value={doc.docId} bind:group={creationChoice} />
                    <span>{text("contactReuseDocument", "收编这个文档")}：{doc.hpath}<br /><small>{doc.docId}</small></span>
                </label>
            {/each}
            <label class="lvct-form__item lvct-form__item--inline">
                <input type="radio" name="lvct-contact-choice" value="new" bind:group={creationChoice} />
                <span>{text("contactCreateDistinct", "这是另一个同名的人，创建独立人物文档")}</span>
            </label>
        </fieldset>
    {/if}

    {#if creationRequest}
        <p class="ft__smaller" role="status">{text("contactCheckpointFrozen", "已保留原请求，资料暂时锁定；继续将先核实原文档和绑定行。")}
            <br />{creationRequest.checkpoint.requestId}{creationRequest.checkpoint.docId ? ` · ${creationRequest.checkpoint.docId}` : ""}</p>
    {/if}

        {#if errorText}
            <!-- D-35：读屏即时播报（role=alert），focus 落到错误块便于键盘继续操作 -->
            <div class="lvct-form__error" role="alert" tabindex="-1" bind:this={errorEl}>{errorText}</div>
        {/if}
        {#if selfSetupOpen}
            <section class="lvct-form__optional-body" aria-label="设置本人档案" aria-busy={selfSetupBusy}>
                <b>设置本人档案</b>
                <p class="lvct-form__hint">设置完成后会回到这里；当前联系人及补充资料草稿会保留。</p>
                {#if onCreateSelfProfile}
                    <button type="button" class="b3-button b3-button--outline" disabled={selfSetupBusy} onclick={() => void createSelfProfileFromContact()}>
                        {selfSetupBusy ? "处理中…" : "创建本人档案「我自己」"}
                    </button>
                {/if}
                {#if onLoadSelfCandidates && selfCandidates.length > 0}
                    <label class="lvct-form__item">
                        <span>或指定一位已有联系人</span>
                        <select class="b3-select fn__block" bind:value={selfCandidateItemId} disabled={selfSetupBusy || !!selfPreview}>
                            <option value="">选择联系人…</option>
                            {#each selfCandidates as candidate (candidate.itemId)}<option value={candidate.itemId}>{candidate.name}{candidate.phone ? ` · ${candidate.phone}` : ""}</option>{/each}
                        </select>
                    </label>
                    {#if !selfPreview}
                        <button type="button" class="b3-button b3-button--outline" disabled={selfSetupBusy || !selfCandidateItemId || !onPreviewSelfIdentityChange} onclick={() => void previewSelfCandidate()}>
                            {selfSetupBusy ? "核对中…" : "预览指定本人"}
                        </button>
                    {/if}
                {:else if onLoadSelfCandidates && !selfSetupBusy}
                    <p class="lvct-form__hint">暂无可指定的现有联系人，可以创建「我自己」档案。</p>
                {/if}
                {#if selfPreview}
                    <div class="lvct-form__optional-body" role="region" aria-label="本人身份影响预览">
                        <p>{selfPreview.previousName} → {selfPreview.target?.name ?? "未指定本人"}</p>
                        <p>普通联系人统计：{selfPreview.ordinaryBefore} → {selfPreview.ordinaryAfter}</p>
                        <p class="lvct-form__hint">首页行动和统计、图谱默认中心将随本人变化；原人物资料与历史记录保留。</p>
                        <button type="button" class="b3-button" disabled={selfSetupBusy} onclick={() => void confirmSelfCandidate()}>{selfSetupBusy ? "保存中…" : "确认指定本人"}</button>
                        <button type="button" class="b3-button b3-button--text" disabled={selfSetupBusy} onclick={() => (selfPreview = null)}>取消预览</button>
                    </div>
                {/if}
                {#if selfSetupError}<p class="lvct-form__error" role="alert">{selfSetupError}</p>{/if}
            </section>
        {/if}
        {#if selfSetupNotice}<p class="lvct-form__hint" role="status">{selfSetupNotice}</p>{/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={() => guardedClose(onClose)} disabled={running}>{text("formCancel", "取消")}</button>
        <button class="b3-button b3-button--text" onclick={submit} disabled={running || !groupValid || draft.name.trim().length === 0 || !!currentPreview && !creationRequest && !creationChoice}>
            {running ? text("formCreating", "创建中…") : creationRequest ? text("contactContinueCreation", "核实并继续原请求") : text("formCreate", "创建联系人")}
        </button>
    </div>
    <p class="ft__smaller ft__on-surface lvct-form__hint">
        {text("formCreateHint", "将创建文档「{name}」并绑定为数据库一行；同名候选须核对后选择具体文档或独立人物。", { name: draft.name || "…" })}
    </p>
</div>

{#if quickFillOpen}
    <QuickFillDialog
        {i18n}
        existing={{ name: draft.name, phone: draft.phone, email: draft.email, wechat: draft.wechat, website: draft.website, birthday: draft.birthday, isLunar: draft.isLunar, group: draft.group, tags: tagsText.split(/[，,、\s]+/).filter(Boolean) }}
        onApply={applyQuickFill}
        onClose={() => (quickFillOpen = false)}
    />
{/if}
