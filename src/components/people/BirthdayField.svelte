<script lang="ts">
    import {
        LUNAR_DAY_NAMES,
        LUNAR_MONTH_NAMES,
        lunarToSolar,
        solarToLunar,
    } from "../../domain/lunar";
    import { birthdayToMs } from "../../domain/person";

    let {
        value = "",
        isLunar = false,
        disabled = false,
        label = "生日",
        onValueChange,
        onModeChange,
    }: {
        value?: string;
        isLunar?: boolean;
        disabled?: boolean;
        label?: string;
        onValueChange: (value: string) => void;
        onModeChange: (isLunar: boolean) => void;
    } = $props();

    const MIN_YEAR = 1900;
    const MAX_YEAR = 2100;
    const years = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, index) => MIN_YEAR + index);
    let lunarYear = $state(0);
    let lunarMonth = $state(0);
    let lunarDay = $state(0);
    let modeError = $state("");
    let lastSynced = "";

    function parseDateKey(input: string): [number, number, number] | undefined {
        const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return undefined;
        return [Number(match[1]), Number(match[2]), Number(match[3])];
    }

    function formatDateKey(year: number, month: number, day: number): string {
        return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    function dateToParts(input: string): [number, number, number] | undefined {
        const parts = parseDateKey(input);
        if (!parts) return undefined;
        const date = new Date(parts[0], parts[1] - 1, parts[2]);
        return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2] ? parts : undefined;
    }

    function syncLunarParts(): void {
        if (!isLunar || value === lastSynced) return;
        lastSynced = value;
        const parts = parseDateKey(value);
        if (!parts) {
            lunarYear = 0;
            lunarMonth = 0;
            lunarDay = 0;
            return;
        }
        lunarYear = parts[0];
        lunarMonth = parts[1];
        lunarDay = parts[2];
    }

    $effect(() => {
        isLunar;
        value;
        syncLunarParts();
    });

    const validLunarDays = $derived.by(() => {
        if (!lunarYear || !lunarMonth) return [] as number[];
        return Array.from({ length: 30 }, (_, index) => index + 1)
            // 联系人的现有 AV 日期列仍以 YYYY-MM-DD 毫秒保存；筛掉
            // 虽然农历有效、但无法编码为该日期格式的组合，避免选完后保存失败。
            .filter((day) => Boolean(lunarToSolar(lunarYear, lunarMonth, day))
                && birthdayToMs(formatDateKey(lunarYear, lunarMonth, day)) !== null);
    });

    function switchMode(nextIsLunar: boolean): void {
        if (nextIsLunar === isLunar) return;
        modeError = "";
        let nextValue = value;
        const parts = parseDateKey(value);
        if (parts) {
            if (nextIsLunar) {
                const solarParts = dateToParts(value);
                if (!solarParts) {
                    modeError = "当前公历日期无效，请先重新选择日期。";
                    return;
                }
                const lunar = solarToLunar(new Date(solarParts[0], solarParts[1] - 1, solarParts[2]));
                if (!lunar) {
                    modeError = "该日期超出农历换算范围（1900-2100），暂不能切换为农历。";
                    return;
                }
                nextValue = formatDateKey(lunar.year, lunar.month, lunar.day);
                if (birthdayToMs(nextValue) === null) {
                    modeError = "该日期对应农历三十，当前生日字段暂不能编码，请改选相邻日期。";
                    return;
                }
                lunarYear = lunar.year;
                lunarMonth = lunar.month;
                lunarDay = lunar.day;
            } else {
                const solar = lunarToSolar(parts[0], parts[1], parts[2]);
                if (!solar) {
                    modeError = "该农历日期超出换算范围（1900-2100），请先调整农历年份。";
                    return;
                }
                nextValue = formatDateKey(solar.getFullYear(), solar.getMonth() + 1, solar.getDate());
            }
        }
        lastSynced = nextIsLunar ? nextValue : "";
        onModeChange(nextIsLunar);
        if (nextValue !== value) onValueChange(nextValue);
    }

    function updateLunarPart(part: "year" | "month" | "day", raw: string): void {
        const parsed = Number(raw);
        if (part === "year") lunarYear = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        if (part === "month") lunarMonth = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        if (part === "day") lunarDay = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        if (lunarDay && lunarMonth && lunarYear && !validLunarDays.includes(lunarDay)) lunarDay = validLunarDays[validLunarDays.length - 1] ?? 0;
        const nextValue = lunarYear && lunarMonth && lunarDay && lunarToSolar(lunarYear, lunarMonth, lunarDay)
            ? formatDateKey(lunarYear, lunarMonth, lunarDay)
            : "";
        lastSynced = nextValue;
        onValueChange(nextValue);
    }
</script>

<div class="lvct-birthday-field">
    <div class="lvct-birthday-field__mode" role="group" aria-label="生日历法">
        <button type="button" class:lvct-birthday-field__mode-active={!isLunar} class="b3-button b3-button--text" aria-pressed={!isLunar} onclick={() => switchMode(false)} {disabled}>公历</button>
        <button type="button" class:lvct-birthday-field__mode-active={isLunar} class="b3-button b3-button--text" aria-pressed={isLunar} onclick={() => switchMode(true)} {disabled}>农历</button>
    </div>
    {#if modeError}<small class="ft__error" role="alert">{modeError}</small>{/if}
    {#if isLunar}
        <div class="lvct-birthday-field__lunar" aria-label={`${label}（农历）`}>
            <select class="b3-select" aria-label="农历年份" value={lunarYear || ""} onchange={(event) => updateLunarPart("year", (event.currentTarget as HTMLSelectElement).value)} {disabled}>
                <option value="">年</option>
                {#each years as year}<option value={year}>{year}年</option>{/each}
            </select>
            <select class="b3-select" aria-label="农历月份" value={lunarMonth || ""} onchange={(event) => updateLunarPart("month", (event.currentTarget as HTMLSelectElement).value)} {disabled}>
                <option value="">月</option>
                {#each LUNAR_MONTH_NAMES as name, index}<option value={index + 1}>{name}月</option>{/each}
            </select>
            <select class="b3-select" aria-label="农历日期" value={lunarDay || ""} onchange={(event) => updateLunarPart("day", (event.currentTarget as HTMLSelectElement).value)} {disabled}>
                <option value="">日</option>
                {#each validLunarDays as day}<option value={day}>{LUNAR_DAY_NAMES[day - 1]}</option>{/each}
            </select>
        </div>
        <small class="lvct-form__hint">直接选择农历年、月、日；保存时会按农历计算生日提醒。</small>
    {:else}
        <input class="b3-text-field fn__block" type="date" aria-label={`${label}（公历）`} value={value} oninput={(event) => onValueChange((event.currentTarget as HTMLInputElement).value)} {disabled} />
        <small class="lvct-form__hint">按公历选择生日。</small>
    {/if}
</div>
