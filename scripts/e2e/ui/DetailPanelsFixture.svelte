<script lang="ts">
    import { untrack } from "svelte";
    import ExchangeLedger from "../../../src/components/people/ExchangeLedger.svelte";
    import PersonAliases from "../../../src/components/people/PersonAliases.svelte";
    import type { ExchangeRecord } from "../../../src/domain/exchanges";
    import type { PersonAlias } from "../../../src/domain/person-aliases";
    import type { CreatePersonExchangeInput } from "../../../src/services/exchanges";

    let {
        firstDocId, secondDocId, loadExchanges, loadAliases,
        createExchange = async () => { throw new Error("未声明往来写入夹具"); },
        addAlias = async () => { throw new Error("未声明别名写入夹具"); },
        onChanged = () => {},
    }: {
        firstDocId: string;
        secondDocId: string;
        loadExchanges: (docId: string) => Promise<ExchangeRecord[]>;
        loadAliases: (docId: string) => Promise<PersonAlias[]>;
        createExchange?: (input: CreatePersonExchangeInput) => Promise<ExchangeRecord>;
        addAlias?: (docId: string, alias: string) => Promise<PersonAlias>;
        onChanged?: () => void;
    } = $props();
    let currentDocId = $state(untrack(() => firstDocId));
</script>

<button type="button" onclick={() => { currentDocId = currentDocId === firstDocId ? secondDocId : firstDocId; }}>切换测试人物</button>
<ExchangeLedger personDocId={currentDocId} onLoad={loadExchanges} onCreate={createExchange}
    onChangeStatus={async () => { throw new Error("未声明状态变更夹具"); }} {onChanged}/>
<PersonAliases personDocId={currentDocId} onLoad={loadAliases} onAdd={addAlias}
    onRemove={async () => { throw new Error("未声明删除别名夹具"); }} {onChanged}/>
