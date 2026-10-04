<script lang="ts">
    import { onDestroy, untrack } from "svelte";
    import { newExchangeRequestId } from "../../services/exchanges";
    import { useCloseGuard } from "../close-guard";
    import { ExchangeWriteUnknownError } from "../../domain/exchanges";
    import { toLocalDateKey } from "../../domain/interactions";
    import type { ExchangeDirection, ExchangeKind, ExchangeRecord, ExchangeStatus } from "../../domain/exchanges";
    import { translateText } from "../../domain/translation";

    let {
        personDocId,
        i18n,
        onLoad,
        onCreate,
        onChangeStatus,
        onChanged,
    }: {
        personDocId: string;
        i18n?: Readonly<Record<string, string>>;
        onLoad: (personDocId: string) => Promise<ExchangeRecord[]>;
        onCreate: (input: {
            requestId: string;
            personDocId: string;
            kind: ExchangeKind;
            direction: ExchangeDirection;
            description: string;
            amount?: number;
            currency?: string;
            occurredOn: string;
            dueOn?: string;
            note?: string;
        }) => Promise<ExchangeRecord>;
        onChangeStatus: (id: string, status: ExchangeStatus, settledOn?: string) => Promise<ExchangeRecord>;
        onChanged?: () => void;
    } = $props();
    const text = $derived.by(() => (key: string, fallback: string, values?: Record<string, string | number>) =>
        translateText(i18n, key, fallback, values));

    let records: ExchangeRecord[] = $state([]);
    let loading = $state(true);
    let busy = $state(false);
    let errorText = $state("");
    let readFailed = $state(false);
    let saveUnknown = $state(false);
    let requestId = newExchangeRequestId();
    let loadGeneration = 0;
    let personGeneration = 0;
    let alive = true;
    let kind = $state<ExchangeKind>("money");
    let direction = $state<ExchangeDirection>("receivable");
    let description = $state("");
    let amountText = $state<string | number | undefined>("");
    let currency = $state("CNY");
    let occurredOn = $state(toLocalDateKey(new Date()));
    let dueOn = $state("");
    let note = $state("");
    let formBaseline = $state("");
    function formSignature(): string {
        return JSON.stringify({ kind, direction, description, amount: String(amountText ?? ""), currency, occurredOn, dueOn, note });
    }
    const formDisabled = $derived(busy || saveUnknown);
    useCloseGuard({
        busy: () => busy,
        dirty: () => saveUnknown || formSignature() !== formBaseline,
        changes: () => [saveUnknown ? text("exchangeUnknownDraft", "往来保存结果仍未知，离开不删除可能已保存的记录") : text("exchangeUnsavedDraft", "往来账本有未保存的输入")],
    });
    onDestroy(() => { alive = false; loadGeneration += 1; });

    const kindLabel = (value: ExchangeKind): string => value === "money" ? "金钱" : value === "item" ? "物品" : "人情";
    const directionLabel = (value: ExchangeDirection): string => value === "receivable" ? "对方欠我" : "我欠对方";

    async function load(docId = personDocId): Promise<void> {
        const generation = ++loadGeneration;
        loading = true;
        errorText = "";
        readFailed = false;
        try {
            const loaded = await onLoad(docId);
            if (!alive || generation !== loadGeneration || docId !== personDocId) return;
            if (loaded.some((record) => record.personDocId !== docId)) throw new Error("往来读取结果包含其他人物，未自动显示");
            records = loaded;
        } catch (error) {
            if (!alive || generation !== loadGeneration || docId !== personDocId) return;
            readFailed = true;
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive && generation === loadGeneration && docId === personDocId) loading = false;
        }
    }

    $effect(() => {
        const docId = personDocId;
        untrack(() => {
            personGeneration += 1;
            records = [];
            resetForm();
            busy = false;
            void load(docId);
        });
    });

    function resetForm(): void {
        description = "";
        amountText = "";
        dueOn = "";
        note = "";
        occurredOn = toLocalDateKey(new Date());
        requestId = newExchangeRequestId();
        saveUnknown = false;
        formBaseline = formSignature();
    }

    async function submit(): Promise<void> {
        if (busy || loading || readFailed || !description.trim()) return;
        busy = true;
        errorText = "";
        const docId = personDocId;
        const activeRequestId = requestId;
        const generation = personGeneration;
        try {
            const amount = kind === "money" && String(amountText ?? "").trim() ? Number(amountText) : undefined;
            await onCreate({
                requestId: activeRequestId,
                personDocId: docId,
                kind,
                direction,
                description: description.trim(),
                ...(amount === undefined ? {} : { amount }),
                currency: kind === "money" ? currency.trim() || "CNY" : undefined,
                occurredOn,
                dueOn,
                note: note.trim(),
            });
            if (!alive || generation !== personGeneration || docId !== personDocId || activeRequestId !== requestId) return;
            resetForm();
            await load(docId);
            if (!alive || generation !== personGeneration || docId !== personDocId) return;
            onChanged?.();
        } catch (error) {
            if (!alive || generation !== personGeneration || docId !== personDocId || activeRequestId !== requestId) return;
            saveUnknown = saveUnknown || error instanceof ExchangeWriteUnknownError;
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive && generation === personGeneration && docId === personDocId) busy = false;
        }
    }

    async function changeStatus(record: ExchangeRecord, status: ExchangeStatus): Promise<void> {
        if (busy || loading || readFailed || saveUnknown) return;
        busy = true;
        errorText = "";
        const docId = personDocId;
        const generation = personGeneration;
        try {
            await onChangeStatus(record.id, status, status === "settled" ? toLocalDateKey(new Date()) : undefined);
            if (!alive || docId !== personDocId || generation !== personGeneration) return;
            await load(docId);
            if (!alive || docId !== personDocId || generation !== personGeneration) return;
            onChanged?.();
        } catch (error) {
            if (!alive || docId !== personDocId || generation !== personGeneration) return;
            errorText = error instanceof Error ? error.message : String(error);
        } finally {
            if (alive && docId === personDocId && generation === personGeneration) busy = false;
        }
    }

    function recordLabel(record: ExchangeRecord): string {
        if (record.kind !== "money") return record.description;
        return `${record.description} · ${record.amount ?? 0} ${record.currency}`;
    }
</script>

<section class="lvct-detail__section" aria-label={text("exchangeSection", "往来账本")}>
    <h4>{text("exchangeTitle", "往来账本")}{records.length ? `（${records.length}）` : ""}</h4>
    <p class="ft__smaller ft__on-surface">{text("exchangeHint", "记录金钱、物品和人情往来；结清后仍保留历史事实。")}</p>
    {#if errorText}<div class="lvct-form__error" role="alert">{errorText}</div>{/if}
    <div class="lvct-form__grid">
        <label class="lvct-form__item">
            <span>{text("exchangeKind", "类型")}</span>
            <select class="b3-select fn__block" bind:value={kind} disabled={formDisabled}>
                <option value="money">{text("exchangeMoney", "金钱")}</option>
                <option value="item">{text("exchangeItem", "物品")}</option>
                <option value="favor">{text("exchangeFavor", "人情")}</option>
            </select>
        </label>
        <label class="lvct-form__item">
            <span>{text("exchangeDirection", "方向")}</span>
            <select class="b3-select fn__block" bind:value={direction} disabled={formDisabled}>
                <option value="receivable">{text("exchangeReceivable", "对方欠我")}</option>
                <option value="payable">{text("exchangePayable", "我欠对方")}</option>
            </select>
        </label>
        <label class="lvct-form__item">
            <span>{text("exchangeDescription", "内容")}</span>
            <input class="b3-text-field fn__block" type="text" bind:value={description} disabled={formDisabled} placeholder={text("exchangeDescriptionPlaceholder", "如：代购机票 / 借出工具 / 帮忙介绍客户")} />
        </label>
        {#if kind === "money"}
            <label class="lvct-form__item">
                <span>{text("exchangeAmount", "金额")}</span>
                <input class="b3-text-field fn__block" type="number" min="0" step="0.01" bind:value={amountText} disabled={formDisabled} />
            </label>
            <label class="lvct-form__item">
                <span>{text("exchangeCurrency", "币种")}</span>
                <input class="b3-text-field fn__block" type="text" bind:value={currency} disabled={formDisabled} />
            </label>
        {/if}
        <label class="lvct-form__item">
            <span>{text("exchangeOccurredOn", "发生日期")}</span>
            <input class="b3-text-field fn__block" type="date" bind:value={occurredOn} disabled={formDisabled} />
        </label>
        <label class="lvct-form__item">
            <span>{text("exchangeDueOn", "到期日期（可选）")}</span>
            <input class="b3-text-field fn__block" type="date" bind:value={dueOn} disabled={formDisabled} />
        </label>
    </div>
    <label class="lvct-form__item">
        <span>{text("exchangeNote", "备注（可选）")}</span>
        <input class="b3-text-field fn__block" type="text" bind:value={note} disabled={formDisabled} />
    </label>
    <div class="lvct-form__actions">
        <button class="b3-button b3-button--text" onclick={submit} disabled={busy || loading || readFailed || !description.trim()}>
            {busy ? text("exchangeSaving", "保存中…") : saveUnknown ? text("exchangeVerifyRetry", "核实并重试本笔往来") : text("exchangeAdd", "记一笔往来")}
        </button>
    </div>

    {#if loading}
        <p class="ft__smaller ft__on-surface">{text("exchangeLoading", "正在读取往来记录…")}</p>
    {:else if readFailed}
        <button type="button" class="b3-button b3-button--outline" onclick={() => void load()} disabled={busy}>{text("retryLoad", "重新读取")}</button>
    {:else if records.length === 0}
        <p class="ft__smaller ft__on-surface">{text("exchangeEmpty", "还没有记录。")}</p>
    {:else}
        <div class="lvct-detail__timeline">
            {#each records as record (record.id)}
                <div class="lvct-detail__timeline-row">
                    <span class="ft__on-surface">{record.occurredOn}</span>
                    <span class="lvct-detail__timeline-note">{recordLabel(record)}</span>
                    <span class="lvct-chip">{kindLabel(record.kind)} · {directionLabel(record.direction)}</span>
                    {#if record.dueOn}<span class="ft__smaller ft__on-surface">到期 {record.dueOn}</span>{/if}
                    <span class="ft__smaller ft__on-surface">{record.status === "open" ? "待处理" : record.status === "settled" ? `已结清${record.settledOn ? ` · ${record.settledOn}` : ""}` : "已取消"}</span>
                    {#if record.status === "open"}
                        <button class="b3-button b3-button--text" disabled={formDisabled || loading || readFailed} onclick={() => changeStatus(record, "settled")}>结清</button>
                        <button class="b3-button b3-button--cancel" disabled={formDisabled || loading || readFailed} onclick={() => changeStatus(record, "cancelled")}>取消</button>
                    {:else if record.status === "settled"}
                        <button class="b3-button b3-button--text" disabled={formDisabled || loading || readFailed} onclick={() => changeStatus(record, "open")}>重新打开</button>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</section>
