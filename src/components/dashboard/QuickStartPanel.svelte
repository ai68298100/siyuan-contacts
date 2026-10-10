<script lang="ts">
    import { ArrowRight, Building2, ContactRound, FolderInput, Network, Settings2, UserPlus } from "@lucide/svelte";
    import { translateText } from "../../domain/translation";

    let {
        i18n,
        saving = false,
        onCreate,
        onImportVCard,
        onImportDocuments,
        onOpenOrganizations,
        onOpenGraph,
        onOpenSettings,
        onDismiss,
    }: {
        i18n?: Readonly<Record<string, string>>;
        saving?: boolean;
        onCreate: () => void;
        onImportVCard: () => void;
        onImportDocuments: () => void;
        onOpenOrganizations: () => void;
        onOpenGraph: () => void;
        onOpenSettings: () => void;
        onDismiss: () => void;
    } = $props();

    const text = (key: string, fallback: string) => translateText(i18n, key, fallback);
</script>

<section class="lvct-dash__quickstart" data-testid="onboarding-quickstart" data-onboarding="quickstart" aria-labelledby="lvct-dash-quickstart-title">
    <div class="lvct-dash__quickstart-head">
        <div>
            <p class="lvct-dash__quickstart-eyebrow">{text("onboardingEyebrow", "快速开始")}</p>
            <h2 id="lvct-dash-quickstart-title">{text("onboardingTitle", "先建立一份联系人名册")}</h2>
            <p>{text("onboardingDescription", "小驴人脉把联系人、互动、组织和提醒放在同一个工作台。你可以从一个联系人开始，之后再逐步补充。")}</p>
        </div>
        <button type="button" class="b3-button b3-button--text" data-onboarding-action="dismiss" disabled={saving} onclick={onDismiss}>
            {saving ? text("onboardingSaving", "保存中…") : text("onboardingDismiss", "以后从设置重新查看")}
        </button>
    </div>

    <div class="lvct-dash__quickstart-grid">
        <button type="button" class="lvct-dash__quickstart-item lvct-dash__quickstart-item--primary" data-testid="onboarding-create" data-onboarding-action="create" onclick={onCreate}>
            <span class="lvct-dash__quickstart-icon" aria-hidden="true"><UserPlus size={18}/></span>
            <span><b>{text("onboardingCreateTitle", "新建联系人")}</b><small>{text("onboardingCreateDesc", "手动填写姓名和少量资料，之后可补充组织、生日和备注。")}</small></span>
            <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button type="button" class="lvct-dash__quickstart-item" data-testid="onboarding-import-vcard" data-onboarding-action="import" onclick={onImportVCard}>
            <span class="lvct-dash__quickstart-icon" aria-hidden="true"><ContactRound size={18}/></span>
            <span><b>{text("onboardingImportTitle", "导入 vCard")}</b><small>{text("onboardingImportDesc", "从通讯录文件批量导入，逐项核对后再保存。")}</small></span>
            <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button type="button" class="lvct-dash__quickstart-item" data-testid="onboarding-import-documents" data-onboarding-action="collect" onclick={onImportDocuments}>
            <span class="lvct-dash__quickstart-icon" aria-hidden="true"><FolderInput size={18}/></span>
            <span><b>{text("onboardingCollectTitle", "收编已有笔记")}</b><small>{text("onboardingCollectDesc", "扫描已有文档，确认后纳入联系人名册。")}</small></span>
            <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button type="button" class="lvct-dash__quickstart-item" data-testid="onboarding-organizations" data-onboarding-action="organizations" onclick={onOpenOrganizations}>
            <span class="lvct-dash__quickstart-icon" aria-hidden="true"><Building2 size={18}/></span>
            <span><b>{text("onboardingOrgTitle", "整理组织归属")}</b><small>{text("onboardingOrgDesc", "公司、学校和家庭可以分别维护，也能保留历史经历。")}</small></span>
            <ArrowRight size={16} aria-hidden="true" />
        </button>
    </div>

    <div class="lvct-dash__quickstart-footer">
        <span>{text("onboardingFeatureHint", "记录互动后，首页会生成生日、久未联系和跟进提醒；关系图谱只展示有来源的连接。")}</span>
        <span class="lvct-dash__quickstart-links">
            <button type="button" class="b3-button b3-button--text" data-onboarding-action="graph" onclick={onOpenGraph}><Network size={15}/>{text("onboardingGraphAction", "查看关系图谱")}</button>
            <button type="button" class="b3-button b3-button--text" data-onboarding-action="settings" onclick={onOpenSettings}><Settings2 size={15}/>{text("onboardingSettingsAction", "打开设置")}</button>
        </span>
    </div>
</section>
