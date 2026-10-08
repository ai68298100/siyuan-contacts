<script lang="ts">
    import { untrack } from "svelte";
    import { PRESET_GROUPS } from "../../services/contacts";
    import {
        GROUP_CLEAR_OPTION,
        GROUP_CUSTOM_OPTION,
        GROUP_KEEP_OPTION,
        normalizeCustomGroupName,
    } from "../../domain/contact-group";
    import { translateText } from "../../domain/translation";

    let {
        i18n,
        value,
        onValueChange,
        onValidityChange,
        label,
        ungroupedLabel,
        disabled = false,
        availableGroups = [],
        allowKeep = false,
        allowClear = false,
        allowUngrouped = true,
    }: {
        i18n?: Readonly<Record<string, string>>;
        value: string;
        onValueChange: (value: string) => void;
        onValidityChange: (valid: boolean) => void;
        label: string;
        ungroupedLabel: string;
        disabled?: boolean;
        availableGroups?: readonly string[];
        allowKeep?: boolean;
        allowClear?: boolean;
        allowUngrouped?: boolean;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string) => translateText(i18n, key, fallback));

    function isListedOption(group: string): boolean {
        return allowUngrouped && group === ""
            || allowKeep && group === GROUP_KEEP_OPTION
            || allowClear && group === GROUP_CLEAR_OPTION
            || PRESET_GROUPS.includes(group as typeof PRESET_GROUPS[number])
            || availableGroups.includes(group);
    }

    function isSystemOption(group: string): boolean {
        return group === ""
            || allowKeep && group === GROUP_KEEP_OPTION
            || allowClear && group === GROUP_CLEAR_OPTION
            || PRESET_GROUPS.includes(group as typeof PRESET_GROUPS[number]);
    }

    const initialValue = untrack(() => value);
    const initialCustomMode = !isListedOption(initialValue);
    let customMode = $state(initialCustomMode);
    let customText = $state(initialCustomMode ? initialValue : "");
    let observedValue = initialValue;
    const customValidation = $derived(normalizeCustomGroupName(customText));
    const customInputId = `lvct-group-custom-${Math.random().toString(36).slice(2, 10)}`;
    const customErrorId = `${customInputId}-error`;

    // 初始值也必须参与校验，避免历史坏值绕过保存按钮的禁用状态。
    untrack(() => onValidityChange(!initialCustomMode || normalizeCustomGroupName(initialValue).ok));

    // 外部识别/草稿回填改变 value 时，同步选择器；用户输入由事件处理器自行更新快照。
    $effect(() => {
        const current = value;
        if (current === observedValue) return;
        observedValue = current;
        if (isListedOption(current)) {
            customMode = false;
            customText = "";
            onValidityChange(true);
        } else {
            customMode = true;
            customText = current;
            onValidityChange(normalizeCustomGroupName(current).ok);
        }
    });

    function setValue(next: string): void {
        observedValue = next;
        onValueChange(next);
    }

    function selectGroup(event: Event): void {
        const next = (event.currentTarget as HTMLSelectElement).value;
        if (next === GROUP_CUSTOM_OPTION) {
            customMode = true;
            customText = isSystemOption(value) ? "" : value;
            const validation = normalizeCustomGroupName(customText);
            setValue(validation.ok ? validation.value : "");
            onValidityChange(validation.ok);
            return;
        }
        customMode = false;
        customText = "";
        setValue(next);
        onValidityChange(true);
    }

    function editCustomGroup(event: Event): void {
        customText = (event.currentTarget as HTMLInputElement).value;
        const validation = normalizeCustomGroupName(customText);
        setValue(validation.ok ? validation.value : "");
        onValidityChange(validation.ok);
    }
</script>

<label class="lvct-form__item">
    <span>{label}</span>
    <select class="b3-select fn__block" value={customMode ? GROUP_CUSTOM_OPTION : value} aria-label={label} {disabled} onchange={selectGroup}>
        {#if allowKeep}<option value={GROUP_KEEP_OPTION}>{text("groupKeep", "保持不变")}</option>{/if}
        {#if allowClear}<option value={GROUP_CLEAR_OPTION}>{text("groupClear", "清空分组")}</option>{/if}
        {#if allowUngrouped}<option value="">{ungroupedLabel}</option>{/if}
        {#each PRESET_GROUPS as group (group)}<option value={group}>{group}</option>{/each}
        {#each availableGroups.filter((group) => !PRESET_GROUPS.includes(group as typeof PRESET_GROUPS[number])) as group (group)}
            <option value={group}>{group}</option>
        {/each}
        <option value={GROUP_CUSTOM_OPTION}>{text("groupCustom", "自定义…")}</option>
    </select>
</label>
{#if customMode}
    <label class="lvct-form__item">
        <span>{text("groupCustomName", "自定义分组名称")}</span>
        <input
            class="b3-text-field fn__block"
            type="text"
            value={customText}
            placeholder={text("groupCustomPlaceholder", "输入具体分组名称")}
            aria-label={text("groupCustomName", "自定义分组名称")}
            aria-invalid={!customValidation.ok}
            aria-describedby={customValidation.ok ? undefined : customErrorId}
            id={customInputId}
            {disabled}
            oninput={editCustomGroup}
        />
        {#if !customValidation.ok}
            <small id={customErrorId} class="ft__error" role="alert">
                {customValidation.reason === "empty"
                    ? text("groupCustomEmpty", "请输入分组名称。")
                    : text("groupCustomReserved", "该名称为内部选项，请换一个分组名称。")}
            </small>
        {:else}
            <small class="ft__smaller ft__on-surface">{text("groupCustomHint", "保存时会自动去除首尾空格。")}</small>
        {/if}
    </label>
{/if}
