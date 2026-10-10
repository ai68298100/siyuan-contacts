<script lang="ts">
    import GroupField from "../../../src/components/people/GroupField.svelte";

    let value = $state("同学");
    let valid = $state(true);
</script>

<GroupField
    value={value}
    label="分组"
    ungroupedLabel="未分组"
    onValueChange={(next) => { value = next; }}
    onValidityChange={(next) => { valid = next; }}
/>
<output data-group-value>{value}</output>
<output data-group-valid>{String(valid)}</output>
