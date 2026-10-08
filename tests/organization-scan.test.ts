import assert from "node:assert/strict";
import test from "node:test";
import { filterOrganizations, organizationMarkerStates, organizationsFromDocs } from "../src/domain/organization-scan.ts";

const orgDocId = "20261004000000-org0001";
const notebookId = "20261004000000-book001";
const marker = { root_id: orgDocId, ial: '{: custom-lvct-org="1"}', markerCount: 1 };
const doc = { id: orgDocId, content: "组织", hpath: "/组织", box: notebookId };

test("组织扫描：合法空库、活跃、归档与稳定文档身份分别核实", () => {
    assert.equal(organizationMarkerStates([]).size, 0);
    assert.deepEqual(organizationsFromDocs(organizationMarkerStates([marker]), [doc]), [{ docId: orgDocId, name: "组织", hpath: "/组织", notebookId, archived: false }]);
    assert.equal(organizationMarkerStates([{ ...marker, ial: '{: custom-lvct-org="archived"}', markerCount: "1" }]).get(orgDocId), true);
});

test("组织扫描：未知值、损坏、重复与同文档冲突都不当作活跃", () => {
    for (const rows of [
        [{ ...marker, ial: '{: custom-lvct-org="future"}' }],
        [{ ...marker, markerCount: 2 }], [{ ...marker, markerCount: undefined }],
        [{ ...marker, root_id: "bad-id" }], [marker, marker],
        [marker, { ...marker, ial: '{: custom-lvct-org="archived"}' }],
        [{ ...marker, ial: '{: custom-lvct-org="1" custom-lvct-org="archived"}' }],
    ]) assert.throws(() => organizationMarkerStates(rows), /组织状态未核实/);
});

test("组织扫描：不可达、不完整、额外与重复文档拒绝完整列表结论", () => {
    const states = organizationMarkerStates([marker]);
    for (const rows of [[], [doc, doc], [{ ...doc, box: undefined }], [{ ...doc, id: "20261004000000-other01" }]]) {
        assert.throws(() => organizationsFromDocs(states, rows), /组织状态未核实/);
    }
});

test("组织筛选：名称查询忽略首尾空白与大小写，状态筛选不改变输入顺序", () => {
    const organizations = [
        { name: "Alpha School", archived: false },
        { name: "Beta Studio", archived: true },
        { name: "alpha labs", archived: false },
    ];
    assert.deepEqual(filterOrganizations(organizations, { query: "  ALPHA  " }).map((item) => item.name), ["Alpha School", "alpha labs"]);
    assert.deepEqual(filterOrganizations(organizations, { status: "active" }).map((item) => item.name), ["Alpha School", "alpha labs"]);
    assert.deepEqual(filterOrganizations(organizations, { status: "archived" }).map((item) => item.name), ["Beta Studio"]);
    assert.deepEqual(organizations.map((item) => item.name), ["Alpha School", "Beta Studio", "alpha labs"]);
});
