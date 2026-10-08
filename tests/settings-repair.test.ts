import assert from "node:assert/strict";
import test from "node:test";
import { FIELD_SPECS } from "../src/domain/fields.ts";
import { assertRepairCheckpointSettings, parseRepairSettings, parseSettingsRepairCheckpoint, repairCompleteFieldMap, verifyRepairRelation } from "../src/domain/settings-repair.ts";
import type { SettingsRepairCheckpoint } from "../src/domain/settings-repair.ts";
import type { ContactsSettings } from "../src/domain/model.ts";

const settings: ContactsSettings = { schemaVersion: 1, notebookId: "20261004000000-book001", notebookName: "隔离",
    hostDocId: "20261004000000-host001", dbBlockId: "20261004000000-table01", avId: "20261004000000-av00001",
    initializedAt: "2026-10-04", fieldMap: Object.fromEntries(FIELD_SPECS.map((spec) => [spec.key, spec.key])) as ContactsSettings["fieldMap"] };
const columns = FIELD_SPECS.map((spec) => ({ id: spec.key, name: spec.nameZh, type: spec.type }));

test("严格设置读取拒绝空、坏容器、未知版本和任一坏映射，不改变启动归一", () => {
    for (const raw of [null, "", [], { ...settings, schemaVersion: 2 }, { ...settings, fieldMap: [] },
        { ...settings, fieldMap: { phone: 1 } }, { ...settings, notebookId: "bad" }]) assert.throws(() => parseRepairSettings(raw));
    assert.deepEqual(parseRepairSettings(settings), settings);
    assert.deepEqual(parseRepairSettings({ ...settings, fieldMap: {} }).fieldMap, {});
});

test("修复核对完整映射，不能占用未改字段或保留旧重复映射", () => {
    const source = { ...settings, fieldMap: { ...settings.fieldMap, phone: "missing" } };
    assert.throws(() => repairCompleteFieldMap(source, { phone: "email" }, columns), /重复|类型/);
    const changedColumns = columns.map((column) => column.id === "wechat" ? { ...column, type: "phone" } : column);
    assert.throws(() => repairCompleteFieldMap(source, { phone: "wechat" }, changedColumns), /重复/);
    assert.throws(() => repairCompleteFieldMap({ ...settings, fieldMap: { ...settings.fieldMap, phone: "email" } }, { website: "website" }, columns), /重复/);
    assert.equal(repairCompleteFieldMap(source, { phone: "phone" }, columns).fieldMap.phone, "phone");
});

test("断点只接纳合法稳定 keyID、关系回链及一致完成状态", () => {
    const checkpoint: SettingsRepairCheckpoint = { schemaVersion: 1, requestId: "20261004000000-repair1", source: settings,
        columns: columns.filter((column) => column.id !== "phone"), complete: false,
        steps: [{ field: "phone", keyId: "20261004000000-newcol1", previousKeyId: "related", columnState: "unknown", mapped: false }] };
    assert.deepEqual(parseSettingsRepairCheckpoint(checkpoint), checkpoint);
    assert.throws(() => parseSettingsRepairCheckpoint({ ...checkpoint, complete: true }));
    assert.throws(() => parseSettingsRepairCheckpoint({ ...checkpoint, steps: [{ ...checkpoint.steps[0], mapped: true }] }));
    assert.throws(() => parseSettingsRepairCheckpoint({ ...checkpoint, steps: [{ ...checkpoint.steps[0], keyId: "related" }] }));
    assert.throws(() => parseSettingsRepairCheckpoint({ ...checkpoint, steps: [checkpoint.steps[0], checkpoint.steps[0]] }));
    checkpoint.steps[0].columnState = "verified";
    assertRepairCheckpointSettings(checkpoint, { ...settings, fieldMap: { ...settings.fieldMap, phone: checkpoint.steps[0].keyId } });
    assert.throws(() => assertRepairCheckpointSettings(checkpoint, { ...settings, fieldMap: { ...settings.fieldMap, phone: "external" } }), /冲突/);
});

test("双向关系要求稳定原列、原回链及两侧配置，不能凭同名回链判成功", () => {
    const keys = [{ id: "forward", name: "相关人", type: "relation", relation: { avID: settings.avId, isTwoWay: true, backKeyID: "backward" } },
        { id: "backward", name: "被相关人", type: "relation", relation: { avID: settings.avId, isTwoWay: true, backKeyID: "forward" } }];
    assert.equal(verifyRepairRelation(keys, settings.avId, "forward", "backward"), true);
    assert.equal(verifyRepairRelation(keys.slice(0, 1), settings.avId, "forward", "backward"), false);
    assert.throws(() => verifyRepairRelation([{ ...keys[0], relation: undefined }, keys[1]], settings.avId, "forward", "backward"), /损坏/);
    assert.throws(() => verifyRepairRelation(keys, "other", "forward", "backward"), /未知/);
});
