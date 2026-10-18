<script lang="ts">
    /** 编辑资料：全字段更新（空值清空对应单元格） */
    import { retryContactFields, updateContactFields } from "../../services/contacts";
    import type { ContactWriteReport, WritableContactField } from "../../domain/contact-write.ts";
    import { changedContactWriteFields } from "../../domain/contact-write.ts";
    import type { ContactDraft } from "../../domain/person";
    import type { ContactSummary } from "../../domain/person";
    import type { ContactsSettings } from "../../domain/model";
    import { isValidMembershipPeriod, isValidOrgStatusLabel, isValidOrgMembershipNote, orgMembershipStatusLabel } from "../../domain/org-membership";
    import type { OrgAffiliationKind, OrgMembership, OrgMembershipPatch, OrgMembershipStatus } from "../../domain/org-membership";
    import type { OrgMembershipWriteReport } from "../../services/org-member-writes";
    import OrgMultiSelect from "../org/OrgMultiSelect.svelte";
    import OrgMembershipResult from "../org/OrgMembershipResult.svelte";
    import type { RelationshipLabelEditorState } from "../../services/people-profiles";
    import { useCloseGuard } from "../close-guard";
    import { translateText } from "../../domain/translation";
    import QuickFillDialog from "./QuickFillDialog.svelte";
    import GroupField from "./GroupField.svelte";
    import BirthdayField from "./BirthdayField.svelte";
    import { ClipboardPaste } from "@lucide/svelte";
    import { onDestroy, onMount, tick, untrack } from "svelte";
    import { requestErrorMessage } from "../../shared/error-presenter";

    let {
        settings,
        i18n,
        availableGroups = [],
        person,
        initialPatch,
        onLoadRelationshipLabels,
        onSaveRelationshipLabels,
        onLoadOrgMemberships,
        onLoadOrgCandidates,
        onCreateOrganization,
        onAddOrgMembership,
        onUpdateOrgMembership,
        onRemoveOrgMembership,
        hostCloseChannel,
        onSaved,
        onClose,
    }: {
        settings: ContactsSettings;
        i18n?: Readonly<Record<string, string>>;
        /** 当前名册中已使用的自定义分组；用于选择已有分组选项。 */
        availableGroups?: readonly string[];
        person: ContactSummary;
        /** 识别结果仅预填草稿；person 始终保留打开时已保存的原人物。 */
        initialPatch?: Partial<ContactDraft>;
        /** B12：编辑弹窗内可直接补充关系称谓及工作/学校归属。 */
        onLoadRelationshipLabels?: (personDocId: string) => Promise<RelationshipLabelEditorState>;
        onSaveRelationshipLabels?: (personDocId: string, selfDocId: string, labels: string[], expected: import("../../domain/person-relationship-labels").PersonRelationshipLabels | null) => Promise<import("../../domain/person-relationship-labels").PersonRelationshipLabels>;
        onLoadOrgMemberships?: (personDocId: string) => Promise<import("../../services/org").PersonOrgMembershipView[]>;
        onLoadOrgCandidates?: () => Promise<ReadonlyArray<{ docId: string; name: string; archived?: boolean }>>;
        onCreateOrganization?: (initialName?: string) => void | { docId: string; name: string } | Promise<void | { docId: string; name: string }>;
        onAddOrgMembership?: (personDocId: string, orgDocId: string, extra?: { department?: string; title?: string; joinedOn?: string; leftOn?: string; status?: OrgMembershipStatus; statusLabel?: string; affiliationKind?: OrgAffiliationKind; note?: string }) => Promise<unknown>;
        onUpdateOrgMembership?: (membershipId: string, patch: OrgMembershipPatch, expected?: OrgMembership) => Promise<unknown>;
        onRemoveOrgMembership?: (membershipId: string, expected?: OrgMembership) => Promise<unknown>;
        /** D-40：libs/dialog 注入的宿主关闭通道（X/Esc/遮罩经守卫路由）；缺省保持宿主原行为 */
        hostCloseChannel?: { request?: (close: () => void) => void };
        onSaved: () => void;
        onClose: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) => translateText(i18n, key, fallback, values));

    // 已保存基线与识别预填分开；编辑草稿不随父层刷新而变化。
    const openedDraft: ContactDraft = untrack(() => ({
        name: person.name,
        phone: person.phone,
        email: person.email,
        wechat: person.wechat,
        website: person.website,
        birthday: person.birthday,
        isLunar: person.isLunar,
        group: person.group,
        tags: [...person.tags],
    }));
    let baseSnapshot: ContactDraft = $state({ ...openedDraft, tags: [...openedDraft.tags] });
    let draft: ContactDraft = $state(untrack(() => ({ ...openedDraft, ...initialPatch,
        tags: [...(initialPatch?.tags ?? openedDraft.tags)],
    })));
    let tagsText: string = $state(untrack(() => draft.tags.join(" ")));
    let running: boolean = $state(false);
    let groupValid = $state(true);
    let errorText: string = $state("");
    type ValidationField = "name" | "email" | "birthday";
    type ValidationIssue = { field: ValidationField; message: string };
    let fieldErrors: Partial<Record<ValidationField, string>> = $state({});
    let validationFocusField: ValidationField | null = $state(null);
    let emailInput: HTMLInputElement | undefined = $state();
    let birthdayField: HTMLElement | undefined = $state();
    let failedFields: WritableContactField[] = $state([]);
    let pending: { draft: ContactDraft; report: ContactWriteReport } | undefined;
    const target = untrack(() => ({ docId: person.docId, itemId: person.itemId }));
    const writeSettings = untrack(() => ({ ...settings, fieldMap: { ...settings.fieldMap } }));
    let alive = true;
    onDestroy(() => { alive = false; });
    // B12：编辑页面直接填写/选择组织归属与本人称谓。组织归属仍以 membership 为唯一事实源。
    // 资料区在首次挂载时先保持加载态，避免生命周期读取开始前短暂显示未初始化的输入框。
    let profileLoading = $state(true);
    let profileBusy = $state(false);
    let profileError = $state("");
    let profileMessage = $state("");
    let relationshipSnapshot = $state<RelationshipLabelEditorState | null>(null);
    let relationshipDraft = $state("");
    let orgCandidates = $state<ReadonlyArray<{ docId: string; name: string; archived?: boolean }>>([]);
    let orgMemberships = $state<import("../../services/org").PersonOrgMembershipView[]>([]);
    type OrgDraftInput = Pick<OrgMembership, "department" | "title" | "joinedOn" | "leftOn" | "status"> & {
        statusLabel: string; affiliationKind: OrgAffiliationKind; note: string;
    };
    type OrgDraft = OrgDraftInput & { orgDocId: string; name: string; archived: boolean; attempted?: OrgDraftInput;
        detailsOpen?: boolean; error?: string; errorField?: "joinedOn" | "leftOn" | "statusLabel" | "note" };
    let orgDrafts = $state<OrgDraft[]>([]);
    let membershipReports = $state<OrgMembershipWriteReport[]>([]);
    let recoveredMemberships = $state<string[]>([]);
    let editingMembershipId = $state("");
    let editingMembershipSnapshot = $state<OrgMembership | null>(null);
    let editingAttemptedInput = $state<OrgDraftInput | null>(null);
    let editingOrgDepartment = $state("");
    let editingOrgTitle = $state("");
    let editingOrgJoinedOn = $state("");
    let editingOrgLeftOn = $state("");
    let editingOrgStatus = $state<OrgMembershipStatus>("active");
    let editingOrgStatusLabel = $state("");
    let editingOrgNote = $state("");
    let editingOrgKind = $state<OrgAffiliationKind>("unspecified");
    let creatingOrganization = $state(false);
    let profileSection: HTMLElement | undefined = $state();
    let removingOrgDocId = $state("");
    let organizationRemovalPanel: HTMLElement | undefined = $state();
    function validateEditDraft(value: ContactDraft): ValidationIssue[] {
        const errors: ValidationIssue[] = [];
        if (!value.name.trim()) errors.push({ field: "name", message: "姓名不能为空" });
        if (value.email.trim() && !/^\S+@\S+\.\S+$/.test(value.email.trim())) errors.push({ field: "email", message: "邮箱格式不正确" });
        if (value.birthday.trim()) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value.birthday.trim())) errors.push({ field: "birthday", message: "生日日期格式不正确" });
            else {
                const [year, month, day] = value.birthday.split("-").map(Number);
                const date = new Date(year, month - 1, day);
                if (!value.isLunar && (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)) errors.push({ field: "birthday", message: "生日不是有效日期" });
            }
        }
        return errors;
    }
    function clearFieldError(field: ValidationField): void {
        if (!(field in fieldErrors)) return;
        const next = { ...fieldErrors };
        delete next[field];
        fieldErrors = next;
        if (validationFocusField === field) validationFocusField = null;
    }
    async function showFieldError(issue: ValidationIssue): Promise<void> {
        fieldErrors = { [issue.field]: issue.message };
        validationFocusField = issue.field;
        await tick();
        const target = issue.field === "email"
            ? emailInput
            : issue.field === "birthday"
                ? birthdayField?.querySelector<HTMLElement>("input, select")
                : null;
        target?.focus();
    }
    // 使用 .by 形式与编辑器逻辑的无 Svelte 运行时测试夹具保持兼容；
    // 这里的派生值仍会由 Svelte 编译器按依赖追踪更新。
    const profileSupported = $derived.by(() => Boolean(onLoadRelationshipLabels || (onLoadOrgCandidates && onAddOrgMembership)));
    const activeOrgIds = $derived.by(() => new Set(orgMemberships.filter((membership) => membership.status === "active").map((membership) => membership.orgDocId)));
    const selectedOrgIds = $derived.by(() => orgDrafts.map((entry) => entry.orgDocId));
    function affiliationLabel(kind: OrgAffiliationKind | undefined): string {
        return kind === "family" ? "家庭" : kind === "work" ? "工作单位" : kind === "education" ? "学校" : "其他组织";
    }
    function addOrgDraft(org: { docId: string; name: string; archived?: boolean }, historical = false): void {
        if (orgDrafts.some((entry) => entry.orgDocId === org.docId)) return;
        orgDrafts = [...orgDrafts, { orgDocId: org.docId, name: org.name, archived: Boolean(org.archived),
            affiliationKind: org.name.trim() === "家庭" ? "family" : "unspecified",
            status: org.archived || historical ? "former" : "active", statusLabel: "", department: "", title: "", joinedOn: "", leftOn: "", note: "", detailsOpen: Boolean(org.archived || historical) }];
    }
    function toggleOrgDraft(docId: string): void {
        const existing = orgDrafts.find((entry) => entry.orgDocId === docId);
        if (existing?.attempted) { profileError = "这段经历的保存结果待核实，请先核实并重试，保留原输入。"; return; }
        if (existing) requestRemoveOrgDraft(existing);
        else {
            const org = orgCandidates.find((entry) => entry.docId === docId);
            if (org) addOrgDraft(org);
        }
    }
    function orgDraftHasDetails(entry: OrgDraft): boolean {
        return entry.affiliationKind !== "unspecified" || entry.status !== "active"
            || [entry.department, entry.title, entry.joinedOn, entry.leftOn, entry.statusLabel, entry.note].some((value) => Boolean(value?.trim()));
    }
    function removeOrgDraftNow(docId: string): void {
        orgDrafts = orgDrafts.filter((item) => item.orgDocId !== docId);
        removingOrgDocId = "";
        void tick().then(focusOrganizationSelector);
    }
    function requestRemoveOrgDraft(entry: OrgDraft): void {
        if (profileBusy) return;
        if (entry.attempted) {
            if (!window.confirm("仅放弃这条本地待核实草稿；可能已保存的组织归属不会撤销。请在已有经历中核对。确定放弃？")) return;
            removeOrgDraftNow(entry.orgDocId);
            return;
        }
        if (orgDraftHasDetails(entry)) {
            removingOrgDocId = entry.orgDocId;
            void tick().then(() => {
                if (removingOrgDocId === entry.orgDocId) organizationRemovalPanel?.focus({ preventScroll: true });
            });
            return;
        }
        removeOrgDraftNow(entry.orgDocId);
    }
    function changeOrgDraftStatus(entry: OrgDraft, status: OrgMembershipStatus): void {
        entry.status = status;
        if (status === "active") entry.leftOn = "";
        else entry.detailsOpen = true;
    }
    function discardOrgDraft(entry: OrgDraft): void {
        requestRemoveOrgDraft(entry);
    }
    function focusOrganizationSelector(): void {
        profileSection?.querySelector<HTMLButtonElement>(".lvct-org-multi__trigger")?.focus({ preventScroll: true });
    }
    function keepOrganizationDraft(): void {
        removingOrgDocId = "";
        void tick().then(focusOrganizationSelector);
    }
    function confirmRemoveOrganizationDraft(): void {
        if (!removingOrgDocId) return;
        removeOrgDraftNow(removingOrgDocId);
    }
    function changeEditingOrgStatus(status: OrgMembershipStatus): void {
        editingOrgStatus = status;
        if (status === "active") editingOrgLeftOn = "";
    }
    const profileDirty = $derived.by(() =>
        Boolean(relationshipSnapshot && onSaveRelationshipLabels && relationshipDraft !== (relationshipSnapshot.record?.labels ?? []).join("、"))
            || orgDrafts.length > 0 || Boolean(editingMembershipId),
    );
    async function loadProfileEditor(preserveDraft = false): Promise<void> {
        if (!profileSupported || !alive) return;
        profileLoading = true;
        profileError = "";
        try {
            // 本人档案没有“与我的关系”这一条关系事实；跳过该读取，避免
            // verifiedReferences 将 selfDocId === personDocId 判定为非法并阻断组织资料。
            const [memberships, candidates] = await Promise.all([
                onLoadOrgMemberships ? onLoadOrgMemberships(person.docId) : Promise.resolve([]),
                onLoadOrgCandidates ? onLoadOrgCandidates() : Promise.resolve([]),
            ]);
            if (!alive) return;
            orgMemberships = memberships;
            orgCandidates = candidates;
            if (!person.isSelf && onLoadRelationshipLabels) {
                const relationship = await onLoadRelationshipLabels(person.docId);
                if (!alive) return;
                if (!preserveDraft || !relationshipSnapshot) relationshipSnapshot = relationship;
                if (!preserveDraft) relationshipDraft = relationship?.record?.labels.join("、") ?? "";
            } else {
                relationshipSnapshot = null;
                if (!preserveDraft) relationshipDraft = "";
            }
        } catch (error) {
            profileError = requestErrorMessage(error);
        } finally { profileLoading = false; }
    }
    /** 新建组织后留在编辑页，并立即刷新候选，避免用户看到过期的“暂无组织”。 */
    async function createOrganizationFromEditor(initialName = ""): Promise<void> {
        if (!onCreateOrganization || creatingOrganization || profileBusy || profileLoading) return;
        creatingOrganization = true;
        profileError = "";
        try {
            const created = await onCreateOrganization(initialName);
            if (!alive) return;
            // 创建不重置其他未保存输入；只依靠返回的文档 ID，不按名称匹配。
            if (created) {
                orgCandidates = [...orgCandidates.filter((entry) => entry.docId !== created.docId), created];
                addOrgDraft(created);
                profileMessage = `已创建「${created.name}」并选中，设置归属后保存。`;
            }
            if (onLoadOrgCandidates) {
                const candidates = await onLoadOrgCandidates();
                if (alive) orgCandidates = created && !candidates.some((entry) => entry.docId === created.docId) ? [...candidates, created] : candidates;
            }
        } catch (error) {
            profileError = requestErrorMessage(error);
        } finally {
            creatingOrganization = false;
            // 候选刷新会重建组织区内容；恢复当前按钮，创建成功后则进入已更新的组织选择框。
            await tick();
            const target = profileSection?.querySelector<HTMLElement>(".lvct-org-multi__trigger");
            if (target?.isConnected) target.focus({ preventScroll: true });
        }
    }
    function membershipSnapshot(membership: import("../../services/org").PersonOrgMembershipView): OrgMembership {
        return { id: membership.id, orgDocId: membership.orgDocId, personDocId: person.docId,
            department: membership.department, title: membership.title, joinedOn: membership.joinedOn,
            leftOn: membership.leftOn, status: membership.status, ...(membership.statusLabel ? { statusLabel: membership.statusLabel } : {}),
            ...(membership.affiliationKind ? { affiliationKind: membership.affiliationKind } : {}),
            ...(membership.note ? { note: membership.note } : {}) };
    }
    function startEditMembership(membership: import("../../services/org").PersonOrgMembershipView): void {
        if (profileBusy || profileLoading || membership.removed) return;
        if (editingAttemptedInput) { profileError = "请先核实正在编辑经历的原保存结果，或取消这条本地编辑。"; return; }
        editingMembershipId = membership.id;
        editingMembershipSnapshot = membershipSnapshot(membership);
        editingOrgDepartment = membership.department;
        editingOrgTitle = membership.title;
        editingOrgJoinedOn = membership.joinedOn;
        editingOrgLeftOn = membership.leftOn;
        editingOrgStatus = membership.archived ? "former" : membership.status;
        editingOrgStatusLabel = membership.statusLabel ?? "";
        editingOrgNote = membership.note ?? "";
        editingOrgKind = membership.affiliationKind ?? "unspecified";
    }
    function cancelEditMembership(): void {
        if (editingAttemptedInput && !window.confirm("仅放弃本地编辑草稿，可能已保存的组织经历不会撤销。确定放弃？")) return;
        editingMembershipId = "";
        editingMembershipSnapshot = null;
        editingAttemptedInput = null;
    }
    async function saveEditMembership(): Promise<void> { await saveProfileEditor(); }
    async function removeMembership(membership: import("../../services/org").PersonOrgMembershipView): Promise<void> {
        if (!onRemoveOrgMembership || profileBusy || profileLoading) return;
        if (!window.confirm(`确定删除「${membership.orgName}」的这段组织经历吗？正常离职或毕业请编辑状态并保留历史。`)) return;
        profileBusy = true;
        profileError = "";
        try {
            const result = await onRemoveOrgMembership(membership.id, membershipSnapshot(membership));
            if (!alive) return;
            const report = result as OrgMembershipWriteReport | undefined;
            if (report?.fact === "verified" && Array.isArray(report.projections)) membershipReports = [...membershipReports, report];
            else {
                if (!onLoadOrgMemberships) throw new Error("删除结果待核实，请重新读取组织经历，未再次删除。");
                orgMemberships = await onLoadOrgMemberships(person.docId);
                if (!alive) return;
                if (orgMemberships.some((entry) => entry.id === membership.id)) throw new Error("删除结果未核实，请重新读取后核对，已保留原经历。");
            }
            if (editingMembershipId === membership.id) { editingMembershipId = ""; editingMembershipSnapshot = null; editingAttemptedInput = null; }
            profileMessage = "组织归属已删除";
            onSaved();
            await loadProfileEditor(true);
        } catch (error) { profileError = requestErrorMessage(error); }
        finally { profileBusy = false; }
    }
    // 运行时由 Svelte 注入 onMount；控制逻辑单测以无生命周期夹具执行，需安全跳过。
    if (typeof onMount === "function") onMount(() => { if (profileSupported) void loadProfileEditor(); });
    function orgDraftInput(entry: OrgDraft): OrgDraftInput {
        return { department: entry.department.trim(), title: entry.title.trim(), joinedOn: entry.joinedOn, leftOn: entry.leftOn,
            status: entry.status, statusLabel: entry.statusLabel.trim(), affiliationKind: entry.affiliationKind, note: entry.note.trim() };
    }
    function matchesOrgInput(membership: OrgMembership, orgDocId: string, input: OrgDraftInput): boolean {
        return membership.orgDocId === orgDocId && membership.personDocId === person.docId
            && membership.department === input.department && membership.title === input.title
            && membership.joinedOn === input.joinedOn && membership.leftOn === input.leftOn && membership.status === input.status
            && (membership.affiliationKind ?? "unspecified") === input.affiliationKind
            && (membership.statusLabel ?? "") === input.statusLabel && (membership.note ?? "") === input.note;
    }
    function validateOrgInput(input: OrgDraftInput, name: string): void {
        if (!isValidMembershipPeriod(input.joinedOn, input.leftOn, input.status)) throw new Error(`「${name}」的日期无效：开始不能晚于结束，当前归属不能有结束日期。`);
        if (!isValidOrgStatusLabel(input.statusLabel) || !isValidOrgMembershipNote(input.note)) throw new Error(`「${name}」的自定义状态或成员备注格式无效。`);
    }
    function orgDetailsSummary(entry: OrgDraft): string {
        const count = [entry.department, entry.title, entry.joinedOn, entry.leftOn, entry.statusLabel, entry.note].filter((value) => value.trim()).length;
        return count ? `已填写 ${count} 项，收起后仍会保存` : "部门、职位、日期与备注（可选）";
    }
    async function showOrgDraftError(entry: OrgDraft, message: string, field?: OrgDraft["errorField"]): Promise<void> {
        entry.error = message;
        entry.errorField = field;
        entry.detailsOpen = true;
        await tick();
        if (!alive) return;
        const card = [...(profileSection?.querySelectorAll<HTMLElement>(".lvct-person-edit__org-draft") ?? [])].find((node) => node.dataset.orgDocId === entry.orgDocId);
        // 原生 toggle 异步派发；刚收起即保存时也以当前 DOM 为准展开无效字段。
        const details = card?.querySelector<HTMLDetailsElement>(".lvct-person-edit__org-more");
        if (details && !details.open) details.open = true;
        const input = field ? card?.querySelector<HTMLElement>(`[data-org-field="${field}"]:not([disabled])`) : undefined;
        (input ?? card?.querySelector<HTMLElement>(".lvct-person-edit__org-error"))?.focus({ preventScroll: true });
        if (card && profileSection) {
            const container = profileSection.closest<HTMLElement>(".lvct-dialog-panel, .b3-dialog__body");
            const node = input ?? card;
            if (container) {
                const rect = node.getBoundingClientRect(), frame = container.getBoundingClientRect();
                if (rect.top < frame.top + 64) container.scrollTop -= frame.top + 64 - rect.top;
                else if (rect.bottom > frame.bottom - 16) container.scrollTop += rect.bottom - frame.bottom + 16;
            }
        }
    }
    function keepMembershipReport(result: unknown, expectedOrgId?: string, input?: OrgDraftInput): OrgMembership | undefined {
        const report = result as OrgMembershipWriteReport | undefined;
        if (!report || report.fact !== "verified" || !report.membership || !Array.isArray(report.projections)) return undefined;
        const org = orgCandidates.find((entry) => entry.docId === report.membership.orgDocId);
        orgMemberships = [...orgMemberships.filter((entry) => entry.id !== report.membership.id),
            { ...report.membership, orgName: org?.name ?? report.membership.orgDocId, archived: Boolean(org?.archived), removed: false, reachable: true }];
        if (expectedOrgId && input && !matchesOrgInput(report.membership, expectedOrgId, input)) {
            throw new Error("该组织已有不同的归属记录，本次设置未保存。请核对已有经历后编辑，未覆盖原记录。");
        }
        membershipReports = [...membershipReports, report];
        return report.membership;
    }
    async function saveProfileEditor(): Promise<void> {
        if (!alive || profileBusy || profileLoading || creatingOrganization || removingOrgDocId || !profileDirty) return;
        profileBusy = true;
        profileError = "";
        profileMessage = "";
        let changed = false;
        let validationFocus: { entry: OrgDraft; message: string; field: OrgDraft["errorField"] } | undefined;
        try {
            // 未知写后结果先按原完整输入核对。重读失败时保持原草稿，不发送新写入。
            if (orgDrafts.some((entry) => entry.attempted) || editingAttemptedInput) {
                if (!onLoadOrgMemberships) throw new Error("无法核实原保存结果，请重新打开并核对组织经历。");
                orgMemberships = await onLoadOrgMemberships(person.docId);
                if (!alive) return;
                if (editingAttemptedInput && editingMembershipSnapshot
                    && orgMemberships.some((item) => item.id === editingMembershipId && matchesOrgInput(membershipSnapshot(item), editingMembershipSnapshot!.orgDocId, editingAttemptedInput!))) {
                    recoveredMemberships = [...recoveredMemberships, "已编辑经历"];
                    editingMembershipId = "";
                    editingMembershipSnapshot = null;
                    editingAttemptedInput = null;
                    changed = true;
                }
                for (const entry of [...orgDrafts]) {
                    if (entry.attempted && orgMemberships.some((membership) => matchesOrgInput(membershipSnapshot(membership), entry.orgDocId, entry.attempted!))) {
                        orgDrafts = orgDrafts.filter((item) => item.orgDocId !== entry.orgDocId);
                        recoveredMemberships = [...recoveredMemberships, entry.name];
                        changed = true;
                    } else if (entry.attempted?.status === "active" && orgMemberships.some((membership) => membership.orgDocId === entry.orgDocId && membership.status === "active")) {
                        entry.attempted = undefined;
                        throw new Error(`「${entry.name}」已有不同的当前归属。本次草稿已保留，请编辑已有经历、改为历史，或取消选择。`);
                    }
                }
            }
            const reservedActiveOrgIds = new Set(activeOrgIds);
            if (editingMembershipSnapshot?.status === "active" && editingOrgStatus === "former") reservedActiveOrgIds.delete(editingMembershipSnapshot.orgDocId);
            const editInput: OrgDraftInput = { department: editingOrgDepartment.trim(), title: editingOrgTitle.trim(), joinedOn: editingOrgJoinedOn,
                leftOn: editingOrgLeftOn, status: editingOrgStatus, statusLabel: editingOrgStatusLabel.trim(), affiliationKind: editingOrgKind, note: editingOrgNote.trim() };
            if (editingMembershipId) {
                validateOrgInput(editInput, "正在编辑的经历");
                if (editingMembershipSnapshot?.status === "former" && editInput.status === "active"
                    && reservedActiveOrgIds.has(editingMembershipSnapshot.orgDocId)) throw new Error("该组织已有其他当前归属，不能恢复这段历史经历。");
            }
            // 所有条目统一校验完成，才开始第一项写入。
            for (const entry of orgDrafts) {
                const input = { ...(entry.attempted ?? orgDraftInput(entry)) };
                entry.error = "";
                entry.errorField = undefined;
                try { validateOrgInput(input, entry.name); }
                catch (error) {
                    const field = !isValidMembershipPeriod(input.joinedOn, "", "former") ? "joinedOn"
                        : !isValidMembershipPeriod(input.joinedOn, input.leftOn, input.status) ? "leftOn"
                        : !isValidOrgStatusLabel(input.statusLabel) ? "statusLabel" : "note";
                    validationFocus = { entry, message: requestErrorMessage(error), field };
                    throw error;
                }
                if (entry.archived && input.status === "active") throw new Error(`「${entry.name}」已归档，只能补录历史经历。`);
                if (input.status === "active") {
                    if (reservedActiveOrgIds.has(entry.orgDocId)) throw new Error(`「${entry.name}」已有当前归属，请编辑已有经历，或将新经历设为已离开。`);
                    reservedActiveOrgIds.add(entry.orgDocId);
                }
            }
            if (editingMembershipId && editingMembershipSnapshot && onUpdateOrgMembership) {
                editingAttemptedInput = { ...editInput };
                const result = await onUpdateOrgMembership(editingMembershipId, editInput, editingMembershipSnapshot);
                if (!alive) return;
                const membership = keepMembershipReport(result, editingMembershipSnapshot.orgDocId, editInput);
                if (!membership) {
                    if (!onLoadOrgMemberships) throw new Error("编辑结果待核实，请保留原输入并重试。");
                    orgMemberships = await onLoadOrgMemberships(person.docId);
                    if (!alive) return;
                    if (!orgMemberships.some((item) => item.id === editingMembershipId && matchesOrgInput(membershipSnapshot(item), editingMembershipSnapshot!.orgDocId, editInput))) throw new Error("编辑结果待核实，请保留原输入并重试。");
                    recoveredMemberships = [...recoveredMemberships, "已编辑经历"];
                }
                editingMembershipId = "";
                editingMembershipSnapshot = null;
                editingAttemptedInput = null;
                changed = true;
            }
            if (relationshipSnapshot && onSaveRelationshipLabels && relationshipSnapshot.selfDocId
                && relationshipDraft !== (relationshipSnapshot.record?.labels ?? []).join("、")) {
                const record = await onSaveRelationshipLabels(person.docId, relationshipSnapshot.selfDocId,
                    relationshipDraft.split(/[、,，\n]/).map((label) => label.trim()).filter(Boolean),
                    relationshipSnapshot.record ? { ...relationshipSnapshot.record, labels: [...relationshipSnapshot.record.labels] } : null);
                if (!alive) return;
                relationshipSnapshot = { selfDocId: record.selfDocId, record };
                relationshipDraft = record.labels.join("、");
                changed = true;
            }
            if (onAddOrgMembership) {
                for (const entry of [...orgDrafts]) {
                    if (!alive) return;
                    const input = { ...(entry.attempted ?? orgDraftInput(entry)) };
                    entry.attempted = { ...input };
                    const result = await onAddOrgMembership(person.docId, entry.orgDocId, input);
                    if (!alive) return;
                    let membership: OrgMembership | undefined;
                    try { membership = keepMembershipReport(result, entry.orgDocId, input); }
                    catch (error) { entry.attempted = undefined; throw error; }
                    // 兼容旧回调时仍要求重读核实，而不凭 Promise resolve 宣称成功。
                    if (!membership) {
                        if (!onLoadOrgMemberships) throw new Error("保存结果待核实，已保留原输入，请重新读取后重试。");
                        orgMemberships = await onLoadOrgMemberships(person.docId);
                        if (!orgMemberships.some((item) => matchesOrgInput(membershipSnapshot(item), entry.orgDocId, input))) throw new Error("保存结果待核实，已保留原输入，请核实并重试。");
                        recoveredMemberships = [...recoveredMemberships, entry.name];
                    }
                    orgDrafts = orgDrafts.filter((item) => item.orgDocId !== entry.orgDocId);
                    changed = true;
                }
            }
            profileMessage = "组织归属与关系称谓已保存";
        } catch (error) {
            profileError = requestErrorMessage(error);
        } finally {
            if (changed && alive) onSaved();
            profileBusy = false;
            if (validationFocus && alive) await showOrgDraftError(validationFocus.entry, validationFocus.message, validationFocus.field);
        }
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
    // B06：字段级改动明细 + 「保存并离开」（persist 抛错则留在原地）
    async function persist(retrying = false): Promise<void> {
        if (!alive) throw new Error("编辑窗口已关闭，未发送新写入");
        if (!groupValid) throw new Error(text("groupCustomEmpty", "请输入分组名称。"));
        const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        const next = { ...draft, tags };
        const validationErrors = validateEditDraft(next);
        if (validationErrors.length > 0) {
            await showFieldError(validationErrors[0]);
            throw new Error(validationErrors.map((issue) => issue.message).join("；"));
        }
        const changed = pending ? changedContactWriteFields(pending.draft, next) : [];
        if (pending && changed.length > 0 && (retrying || pending.report.unknown.length > 0)) {
            throw new Error("草稿与原请求不同；未知字段请先恢复原输入并核实，明确失败后修改输入请使用保存");
        }
        const fields = pending?.report.unresolved.map((failure) => failure.field);
        const report = pending && changed.length === 0
            ? await retryContactFields(writeSettings, target.itemId, pending.draft, fields!, target, () => alive)
            : await updateContactFields(writeSettings, target.itemId, next, {
                expected: target, canWrite: () => alive,
                ...(pending ? { onlyFields: [...new Set([...fields!, ...changed])] } : {}),
            });
        if (!alive) return;
        pending = { draft: { ...next, tags: [...tags] }, report };
        failedFields = report.unresolved.map((failure) => failure.field);
        if (!report.complete) {
            throw new Error(`字段尚未完成：${report.unresolved.map((failure) => `${failure.label}（${failure.message}）`).join("、")}；已核实字段保留，请核实并重试未完成字段`);
        }
        baseSnapshot = { ...next, tags: [...tags] };
        onSaved();
    }

    async function retryFailed(): Promise<void> {
        if (running || profileBusy || creatingOrganization || (profileSupported && profileLoading) || failedFields.length === 0) return;
        running = true;
        errorText = "";
        try {
            await persist(true);
            if (profileDirty) {
                await saveProfileEditor();
                if (profileError) throw new Error(profileError);
            }
            if (alive) onClose();
        } catch (error) {
            if (alive) errorText = requestErrorMessage(error);
        } finally {
            running = false;
        }
    }
    function draftChanges(): string[] {
        const changes: string[] = [];
        const empty = text("guardEmpty", "（空）");
        const fields = [
            [text("formName", "姓名"), "name"], [text("formPhone", "电话"), "phone"],
            [text("formEmail", "邮箱"), "email"], [text("formWechat", "微信"), "wechat"],
            [text("formWebsite", "网站"), "website"], [text("formBirthday", "生日"), "birthday"],
        ] as const;
        for (const [label, key] of fields) {
            if (draft[key] !== baseSnapshot[key]) {
                changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: label, from: String(baseSnapshot[key]) || empty, to: String(draft[key]) || empty }));
            }
        }
        if (draft.isLunar !== baseSnapshot.isLunar) {
            changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: text("formLunar", "农历生日"), from: baseSnapshot.isLunar ? "✓" : empty, to: draft.isLunar ? "✓" : empty }));
        }
        if (draft.group !== baseSnapshot.group) {
            changes.push(text("guardFieldChange", "{field}：{from} → {to}", { field: text("formGroup", "分组"), from: baseSnapshot.group || empty, to: draft.group || empty }));
        }
        const originalTags = baseSnapshot.tags.join(" ");
        if (tagsText !== originalTags) {
            changes.push(text("guardTagsChange", "标签：{from} → {to}", { from: originalTags || empty, to: tagsText || empty }));
        }
        return changes;
    }
    const profileChanges = (): string[] => profileDirty ? ["组织归属或与我的关系有未保存修改"] : [];
    const baseDraftDirty = (): boolean => JSON.stringify({ ...draft, tags: tagsText.split(/[，,、\s]+/).filter(Boolean) }) !== JSON.stringify(baseSnapshot);
    async function persistAll(): Promise<void> {
        if (profileSupported && (profileLoading || profileBusy || creatingOrganization)) throw new Error("组织资料正在处理，请稍后再保存。");
        if (baseDraftDirty()) await persist();
        if (profileDirty) {
            await saveProfileEditor();
            if (profileError) throw new Error(profileError);
        }
    }
    const guardedClose = useCloseGuard({
        busy: () => running || profileBusy || profileLoading || creatingOrganization,
        dirty: () => baseDraftDirty() || profileDirty,
        changes: () => [...draftChanges(), ...profileChanges()],
        save: persistAll,
    });
    /* D-40：宿主 X/Esc/遮罩经同一守卫路由（返回 Promise 供拦截层重入门） */
    // svelte-ignore state_referenced_locally
    if (hostCloseChannel) hostCloseChannel.request = (close) => guardedClose(close);

    /* D-35：错误出现时焦点迁入错误块 */
    let errorEl: HTMLElement | undefined = $state();
    function focusError(): void {
        queueMicrotask(() => errorEl?.focus());
    }

    async function submit() {
        if (running) return;
        const tags = tagsText.split(/[，,、\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        const validationErrors = validateEditDraft({ ...draft, tags });
        if (validationErrors.length > 0) {
            errorText = "";
            await showFieldError(validationErrors[0]);
            return;
        }
        running = true;
        errorText = "";
        try {
            await persistAll();
            if (alive) onClose();
        } catch (error) {
            if (alive && ((validationFocusField && validationFocusField !== "name") || (profileError && orgDrafts.some((entry) => entry.error)))) {
                errorText = "";
            } else if (alive) {
                errorText = requestErrorMessage(error);
                focusError();
            }
        } finally {
            running = false;
        }
    }
</script>

<div class="lvct-form">
    <div class="lvct-form__toolbar">
        <button type="button" class="b3-button b3-button--text lvct-form__toolbar-btn" onclick={() => (quickFillOpen = true)} disabled={running}>
            <ClipboardPaste size={14}/>{text("qfOpen", "粘贴并识别")}
        </button>
    </div>
    {#if profileSupported}
        <section class="lvct-detail__section lvct-person-edit__profile" aria-labelledby="lvct-person-edit-profile-title" bind:this={profileSection}>
            <div class="lvct-detail__section-head">
                <div>
                    <h4 id="lvct-person-edit-profile-title">{person.isSelf ? "组织归属" : "组织归属与我的关系"}</h4>
                    <p class="ft__smaller ft__on-surface">{person.isSelf
        ? "可添加多个家庭、工作单位、学校或其他组织；离职、毕业和自定义状态都会保留历史。"
        : "可直接填写关系称谓，也可添加多个家庭、工作单位、学校或其他组织；每段经历独立保存。"}</p>
                </div>
            </div>
            {#if profileLoading}
                <p role="status">正在读取可编辑资料…</p>
            {:else}
                {#if !person.isSelf && onLoadRelationshipLabels && onSaveRelationshipLabels}
                    <label class="lvct-form__item">
                        <span>与我的关系（多个称谓用顿号分隔）</span>
                        <input class="b3-text-field fn__block" type="text" maxlength="1600" bind:value={relationshipDraft} disabled={profileBusy} placeholder="例如：同事、朋友" />
                    </label>
                {/if}
                {#if onLoadOrgCandidates && onAddOrgMembership}
                    <OrgMultiSelect items={orgCandidates} value={selectedOrgIds} existingIds={[...activeOrgIds]} lockedIds={orgDrafts.filter((entry) => entry.attempted).map((entry) => entry.orgDocId)}
                        disabled={profileBusy || running || Boolean(removingOrgDocId)} creating={creatingOrganization} onToggle={toggleOrgDraft}
                        onCreate={onCreateOrganization ? (name) => void createOrganizationFromEditor(name) : undefined} />
                    {#if removingOrgDocId}
                        {@const pendingOrg = orgDrafts.find((entry) => entry.orgDocId === removingOrgDocId)}
                        <div class="lvct-person-edit__org-confirm" role="alertdialog" aria-modal="false" aria-label="取消组织经历" tabindex="-1" bind:this={organizationRemovalPanel}
                            onkeydown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); keepOrganizationDraft(); } }}>
                            <p>取消选择「{pendingOrg?.name ?? removingOrgDocId}」将丢失已填写的组织资料。</p>
                            <button type="button" class="b3-button b3-button--cancel" onclick={keepOrganizationDraft}>保留经历</button>
                            <button type="button" class="b3-button b3-button--outline" onclick={confirmRemoveOrganizationDraft}>确认移除这条经历</button>
                        </div>
                    {/if}
                    {#each orgDrafts as entry (entry.orgDocId)}
                        <div class="lvct-person-edit__org-draft" data-org-doc-id={entry.orgDocId} oninput={() => { entry.error = ""; entry.errorField = undefined; }} onchange={() => { entry.error = ""; entry.errorField = undefined; }}>
                            <div class="lvct-person-edit__org-draft-head"><strong>{entry.name}</strong>
                                <button type="button" class="b3-button b3-button--text" aria-label={`${entry.attempted ? "放弃本地草稿" : "取消选择"}${entry.name}`} disabled={profileBusy} onclick={() => discardOrgDraft(entry)}>{entry.attempted ? "放弃本地草稿" : "取消选择"}</button>
                            </div>
                            <div class="lvct-form__grid">
                                <label class="lvct-form__item"><span>归属分类</span><select class="b3-select fn__block" bind:value={entry.affiliationKind} disabled={profileBusy || Boolean(entry.attempted)}><option value="work">工作单位</option><option value="education">学校</option><option value="family">家庭</option><option value="unspecified">其他组织</option></select></label>
                                <label class="lvct-form__item"><span>当前状态</span><select class="b3-select fn__block" value={entry.status} onchange={(event) => changeOrgDraftStatus(entry, event.currentTarget.value as OrgMembershipStatus)} disabled={profileBusy || Boolean(entry.attempted)}><option value="active" disabled={entry.archived}>当前归属</option><option value="former">已离开/毕业</option></select></label>
                            </div>
                            <details class="lvct-person-edit__org-more" bind:open={entry.detailsOpen}>
                                <summary><span>更多设置</span><small class="ft__on-surface">{orgDetailsSummary(entry)}</small></summary>
                                <div class="lvct-form__grid">
                                <label class="lvct-form__item"><span>部门/院系</span><input class="b3-text-field fn__block" bind:value={entry.department} disabled={profileBusy || Boolean(entry.attempted)} /></label>
                                <label class="lvct-form__item"><span>职位/身份</span><input class="b3-text-field fn__block" bind:value={entry.title} disabled={profileBusy || Boolean(entry.attempted)} /></label>
                                <label class="lvct-form__item"><span>开始日期</span><input class="b3-text-field fn__block" type="date" bind:value={entry.joinedOn} data-org-field="joinedOn" aria-invalid={entry.errorField === "joinedOn"} aria-describedby={entry.errorField === "joinedOn" ? `lvct-org-draft-error-${entry.orgDocId}` : undefined} disabled={profileBusy || Boolean(entry.attempted)} /></label>
                                <label class="lvct-form__item"><span>结束日期</span><input class="b3-text-field fn__block" type="date" bind:value={entry.leftOn} data-org-field="leftOn" aria-invalid={entry.errorField === "leftOn"} aria-describedby={entry.errorField === "leftOn" ? `lvct-org-draft-error-${entry.orgDocId}` : undefined} disabled={profileBusy || entry.status === "active" || Boolean(entry.attempted)} /></label>
                                <label class="lvct-form__item"><span>自定义状态</span><input class="b3-text-field fn__block" maxlength="40" bind:value={entry.statusLabel} data-org-field="statusLabel" aria-invalid={entry.errorField === "statusLabel"} aria-describedby={entry.errorField === "statusLabel" ? `lvct-org-draft-error-${entry.orgDocId}` : undefined} disabled={profileBusy || Boolean(entry.attempted)} placeholder="例如：兼职、社团骨干、休学" /></label>
                                <label class="lvct-form__item"><span>成员备注</span><input class="b3-text-field fn__block" maxlength="240" bind:value={entry.note} data-org-field="note" aria-invalid={entry.errorField === "note"} aria-describedby={entry.errorField === "note" ? `lvct-org-draft-error-${entry.orgDocId}` : undefined} disabled={profileBusy || Boolean(entry.attempted)} placeholder="仅记录这段组织经历" /></label>
                                </div>
                            </details>
                            {#if entry.error}<p class="lvct-form__error lvct-person-edit__org-error" id={`lvct-org-draft-error-${entry.orgDocId}`} tabindex="-1" role="alert">{entry.error}</p>{/if}
                            {#if entry.archived}<p class="ft__smaller ft__on-surface">组织已归档，只能补录历史经历。</p>{/if}
                            {#if entry.attempted}<p class="ft__smaller ft__on-surface">原输入已保留，请点击“保存组织与称谓”核实并重试；已确认的经历不会重复添加。</p>{/if}
                        </div>
                    {/each}
                    {#if orgMemberships.length > 0}
                        <div class="lvct-person-edit__org-list">
                            <h5>已有组织经历</h5>
                            {#each orgMemberships as membership (membership.id)}
                                <div class="lvct-person-edit__org-item">
                                    <div class="fn__flex-1">
                                        <strong>{membership.orgName}</strong>
                                        <span class="ft__smaller ft__on-surface"> · {affiliationLabel(membership.affiliationKind ?? (membership.orgName === "家庭" ? "family" : undefined))}</span>
                                        <span class="lvct-chip {membership.status === "former" ? "lvct-bucket--stale" : "lvct-bucket--today"}">{orgMembershipStatusLabel({ ...membership, affiliationKind: membership.affiliationKind ?? (membership.orgName === "家庭" ? "family" : undefined) })}</span>
                                        {#if membership.removed}<span class="lvct-chip lvct-bucket--stale">组织已移除</span>
                                        {:else if membership.archived}<span class="lvct-chip lvct-bucket--stale">组织已归档</span>{/if}
                                        {#if membership.reachable === false}<span class="lvct-chip lvct-bucket--stale">组织待核实</span>{/if}
                                        {#if membership.department}<span class="ft__smaller"> · {membership.department}</span>{/if}
                                        {#if membership.title}<span class="ft__smaller"> · {membership.title}</span>{/if}
                                        {#if membership.joinedOn || membership.leftOn}<span class="ft__smaller ft__on-surface"> · {membership.joinedOn || "未知"} – {membership.leftOn || "至今"}</span>{/if}
                                        {#if membership.note}<span class="ft__smaller ft__on-surface" title={membership.note}> · {membership.note}</span>{/if}
                                    </div>
                                    {#if onUpdateOrgMembership}<button type="button" class="b3-button b3-button--text" onclick={() => startEditMembership(membership)} disabled={profileBusy || profileLoading || membership.removed}>编辑</button>{/if}
                                    {#if !membership.removed}<button type="button" class="b3-button b3-button--text" onclick={() => addOrgDraft({ docId: membership.orgDocId, name: membership.orgName, archived: membership.archived }, true)} disabled={profileBusy || profileLoading || selectedOrgIds.includes(membership.orgDocId)}>补录历史</button>{/if}
                                    {#if onRemoveOrgMembership}<button type="button" class="b3-button b3-button--cancel" onclick={() => void removeMembership(membership)} disabled={profileBusy || profileLoading || membership.removed}>删除</button>{/if}
                                    {#if membership.removed}<span class="ft__smaller ft__on-surface">组织已移除；恢复组织后才能维护这段经历。</span>{/if}
                                </div>
                                {#if editingMembershipId === membership.id}
                                    <div class="lvct-form__grid lvct-person-edit__org-edit">
                                        <label class="lvct-form__item"><span>归属分类</span><select class="b3-select fn__block" bind:value={editingOrgKind} disabled={profileBusy || Boolean(editingAttemptedInput)}><option value="work">工作单位</option><option value="education">学校</option><option value="family">家庭</option><option value="unspecified">其他组织</option></select></label>
                                        <label class="lvct-form__item"><span>当前状态</span><select class="b3-select fn__block" value={editingOrgStatus} onchange={(event) => changeEditingOrgStatus(event.currentTarget.value as OrgMembershipStatus)} disabled={profileBusy || Boolean(editingAttemptedInput)}><option value="active" disabled={membership.archived}>当前归属</option><option value="former">已离开/毕业</option></select></label>
                                        <label class="lvct-form__item"><span>自定义状态</span><input class="b3-text-field fn__block" maxlength="40" bind:value={editingOrgStatusLabel} disabled={profileBusy || Boolean(editingAttemptedInput)} placeholder="例如：实习、兼职、休学" /></label>
                                        <label class="lvct-form__item"><span>{text("orgMemberNote", "成员备注")}</span><input class="b3-text-field fn__block" maxlength="240" bind:value={editingOrgNote} disabled={profileBusy || Boolean(editingAttemptedInput)} placeholder={text("orgMemberNotePlaceholder", "仅记录这段组织经历")} /></label>
                                        <label class="lvct-form__item"><span>部门/院系</span><input class="b3-text-field fn__block" bind:value={editingOrgDepartment} disabled={profileBusy || Boolean(editingAttemptedInput)} /></label>
                                        <label class="lvct-form__item"><span>职位/身份</span><input class="b3-text-field fn__block" bind:value={editingOrgTitle} disabled={profileBusy || Boolean(editingAttemptedInput)} /></label>
                                        <label class="lvct-form__item"><span>开始日期</span><input class="b3-text-field fn__block" type="date" bind:value={editingOrgJoinedOn} disabled={profileBusy || Boolean(editingAttemptedInput)} /></label>
                                        <label class="lvct-form__item"><span>结束日期</span><input class="b3-text-field fn__block" type="date" bind:value={editingOrgLeftOn} disabled={profileBusy || Boolean(editingAttemptedInput) || editingOrgStatus === "active"} /></label>
                                        <div class="lvct-form__actions"><button type="button" class="b3-button b3-button--text" onclick={() => void saveEditMembership()} disabled={profileBusy}>保存</button><button type="button" class="b3-button b3-button--cancel" onclick={cancelEditMembership} disabled={profileBusy}>取消</button></div>
                                    </div>
                                {/if}
                            {/each}
                        </div>
                    {/if}
                {/if}
                {#each membershipReports as report, index (index)}
                    <OrgMembershipResult {report} {i18n} />
                {/each}
                {#if recoveredMemberships.length}<p role="status">已重读核实：{recoveredMemberships.join("、")}。成员事实已保留；双链状态请到设置 → 数据与字段 → 组织成员双链核对。</p>{/if}
                {#if profileError}
                    <p class="lvct-form__error" role="alert">{profileError}</p>
                    <button type="button" class="b3-button b3-button--outline" onclick={() => void loadProfileEditor(true)} disabled={profileBusy || profileLoading}>
                        {profileLoading ? "重新读取中…" : "重新读取资料"}
                    </button>
                {/if}
                {#if profileMessage}<p role="status">{profileMessage}</p>{/if}
                <button type="button" class="b3-button b3-button--outline" onclick={() => void saveProfileEditor()} disabled={profileBusy || creatingOrganization || running || Boolean(removingOrgDocId) || !profileDirty}>
                    {profileBusy ? "保存资料中…" : "保存组织与称谓"}
                </button>
            {/if}
        </section>
    {/if}
    <div class="lvct-form__grid">
        <label class="lvct-form__item">
            <span>{text("formPhone", "电话")}</span>
            <input class="b3-text-field fn__block" type="tel" bind:value={draft.phone} disabled={running} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formWechat", "微信")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={draft.wechat} disabled={running} />
        </label>
        <label class="lvct-form__item">
            <span>{text("formEmail", "邮箱")}</span>
            <input class="b3-text-field fn__block" type="email" bind:this={emailInput} bind:value={draft.email} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "lvct-person-edit-email-error" : undefined} oninput={() => clearFieldError("email")} disabled={running} />
            {#if fieldErrors.email}<small id="lvct-person-edit-email-error" class="lvct-form__error" role="alert">{fieldErrors.email}</small>{/if}
        </label>
        <label class="lvct-form__item">
            <span>{text("formWebsite", "网站")}</span>
            <input class="b3-text-field fn__block" type="url" bind:value={draft.website} disabled={running} />
        </label>
        <div class="lvct-form__item" bind:this={birthdayField}>
            <span>{text("formBirthday", "生日")}</span>
            <BirthdayField label={text("formBirthday", "生日")} value={draft.birthday} isLunar={draft.isLunar} invalid={Boolean(fieldErrors.birthday)} describedBy={fieldErrors.birthday ? "lvct-person-edit-birthday-error" : undefined} disabled={running} onValueChange={(value) => { draft.birthday = value; clearFieldError("birthday"); }} onModeChange={(isLunar) => { draft.isLunar = isLunar; clearFieldError("birthday"); }} />
            {#if fieldErrors.birthday}<small id="lvct-person-edit-birthday-error" class="lvct-form__error" role="alert">{fieldErrors.birthday}</small>{/if}
        </div>
        <GroupField {i18n} value={draft.group} onValueChange={(value) => (draft.group = value)} onValidityChange={(valid) => (groupValid = valid)} label={text("formGroup", "分组")} ungroupedLabel={text("formUngrouped", "未分组")} {availableGroups} disabled={running} />
        <label class="lvct-form__item">
            <span>{text("formTagsLabel", "标签（空格/逗号分隔）")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={tagsText} disabled={running} />
        </label>
    </div>

    {#if errorText}
        <!-- D-35：读屏即时播报 + 焦点迁移 -->
        <div class="lvct-form__error" role="alert" tabindex="-1" bind:this={errorEl}>{errorText}</div>
    {/if}

    <div class="lvct-form__actions">
        <button class="b3-button b3-button--cancel" onclick={() => guardedClose(onClose)} disabled={running}>{text("formCancel", "取消")}</button>
        {#if failedFields.length > 0}
            <button class="b3-button b3-button--outline" onclick={retryFailed} disabled={running || profileBusy || creatingOrganization || (profileSupported && profileLoading) || !groupValid}>{text("formRetryFailed", "核实并重试未完成字段")}</button>
        {/if}
        <button class="b3-button b3-button--primary" onclick={submit} disabled={running || profileBusy || creatingOrganization || (profileSupported && profileLoading) || !groupValid}>
            {running ? text("formSaving", "保存中…") : text("formSave", "保存")}
        </button>
    </div>
    <p class="ft__smaller ft__on-surface lvct-form__hint">{text("formEditHint", "留空将清除该字段；如需修改姓名，重命名对应的人物文档即可。")}</p>
</div>

{#if quickFillOpen}
    <QuickFillDialog
        {i18n}
        existing={{ name: draft.name, phone: draft.phone, email: draft.email, wechat: draft.wechat, website: draft.website, birthday: draft.birthday, isLunar: draft.isLunar, group: draft.group, tags: tagsText.split(/[，,、\s]+/).filter(Boolean) }}
        onApply={applyQuickFill}
        onClose={() => (quickFillOpen = false)}
    />
{/if}

<style>
    .lvct-person-edit__org-draft { border: 1px solid var(--lvct-border-subtle); border-radius: 8px; padding: 12px; margin: 12px 0; min-width: 0; }
    .lvct-person-edit__org-draft-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
    .lvct-person-edit__org-draft-head strong { min-width: 0; overflow-wrap: anywhere; }
    .lvct-person-edit__org-draft-head button { flex-shrink: 0; }
    .lvct-person-edit__org-confirm { padding: 12px; margin-top: 8px; border: 1px solid var(--lvct-accent); border-radius: 8px; }
    .lvct-person-edit__org-more { margin-top: 8px; }
    .lvct-person-edit__org-more summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 40px; cursor: pointer; }
    .lvct-person-edit__org-more summary::before { content: "▸"; color: var(--lvct-accent); }
    .lvct-person-edit__org-more[open] summary::before { content: "▾"; }
    .lvct-person-edit__org-more summary:focus-visible { outline: 2px solid var(--lvct-accent); border-radius: 4px; }
    .lvct-person-edit__org-more summary small { font-size: 12px; }
    .lvct-person-edit__org-more[open] summary { margin-bottom: 8px; }
    .lvct-person-edit__org-draft :global(.lvct-form__grid) { margin-bottom: 0; }
</style>
