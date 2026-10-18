import test from "node:test";
import assert from "node:assert/strict";
import {
    buildOrganizationMemberCsv,
    buildOrganizationMemberTsv,
    escapeCsvCell,
    filterOrganizationMemberExportRows,
    matchesOrganizationMemberQuery,
    serializeOrganizationMembersTsv,
    type OrganizationMemberExportRow,
} from "../src/domain/org-members-export.ts";

const row: OrganizationMemberExportRow = {
    id: "20261018000000-m000001",
    orgDocId: "20261018000000-o000001",
    organizationName: "研发,平台",
    personDocId: "20261018000000-p000001",
    personName: "=危险姓名",
    department: "研发,平台",
    title: "工程\t师",
    status: "active",
    statusLabel: "在职",
    affiliationKind: "work",
    joinedOn: "2024-01-01",
    leftOn: "",
    note: "备注\n含换行",
};

test("组织成员 CSV：中文表头、特殊字符和公式前缀安全转义", () => {
    const output = buildOrganizationMemberCsv([row]);
    assert.ok(output.startsWith("\uFEFF\"组织名称\",\"成员姓名\""));
    assert.match(output, /"'=危险姓名"/);
    assert.match(output, /"研发,平台"/);
    assert.match(output, /"工程 师"/);
    assert.match(output, /"备注 含换行"/);
    assert.ok(output.endsWith("\r\n"));
});

test("组织成员 TSV：固定列顺序、单行安全内容和稳定记录 ID", () => {
    const output = buildOrganizationMemberTsv([row]);
    const lines = output.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[0], "组织名称\t成员姓名\t状态\t自定义状态\t归属分类\t部门\t职位\t加入日期\t离开日期\t成员备注\t人物文档 ID\t成员记录 ID\t组织文档 ID");
    assert.equal(lines[1].split("\t").length, 13);
    assert.ok(lines[1].includes("'=危险姓名"));
    assert.ok(lines[1].includes("20261018000000-m000001\t20261018000000-o000001"));
});

test("组织成员 CSV 单元格：双引号成对转义", () => {
    assert.equal(escapeCsvCell('甲"乙'), '"甲""乙"');
});

test("组织成员筛选：搜索字段和状态筛选保持列表语义", () => {
    const former = { ...row, id: "former", personName: "乙", status: "former" as const, note: "历史项目" };
    assert.deepEqual(filterOrganizationMemberExportRows([row, former], { query: "历史", status: "former" }), [former]);
    assert.deepEqual(filterOrganizationMemberExportRows([row, former], { query: "危险", status: "all" }), [row]);
});

const workflowRows: OrganizationMemberExportRow[] = [
    {
        id: "20261018000000-m000001",
        orgDocId: "20261018000000-o000001",
        organizationName: "小驴科技",
        personDocId: "20261018000000-p000001",
        personName: "张三",
        department: "研发",
        title: "工程师",
        joinedOn: "2024-01-01",
        leftOn: "",
        status: "active",
        statusLabel: "核心成员",
        affiliationKind: "work",
        note: "负责 API\t维护\n值班",
    },
    {
        id: "20261018000000-m000002",
        orgDocId: "20261018000000-o000001",
        organizationName: "小驴科技",
        personDocId: "20261018000000-p000002",
        personName: "李四",
        department: "产品",
        title: "前产品经理",
        joinedOn: "2022-01-01",
        leftOn: "2025-01-01",
        status: "former",
        statusLabel: "已离职",
        affiliationKind: "work",
        note: "历史成员",
    },
];

test("组织成员工作流 TSV：组织名、状态分类和多行字段均保持单行", () => {
    const output = serializeOrganizationMembersTsv(workflowRows, { organizationName: "小驴科技" });
    assert.ok(output.startsWith("\uFEFF组织名称\t成员姓名"));
    const lines = output.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[1].split("\t").length, 13);
    assert.ok(lines[1].includes("小驴科技\t张三\t核心成员\t核心成员\t工作单位"));
    assert.ok(lines[1].includes("负责 API 维护 值班"));
    assert.ok(lines[2].includes("小驴科技\t李四\t已离职\t已离职"));
});

test("组织成员工作流 TSV：可关闭 BOM，筛选查询不改写原数组", () => {
    const output = serializeOrganizationMembersTsv(workflowRows, { includeBom: false });
    assert.ok(!output.startsWith("\uFEFF"));
    const filtered = filterOrganizationMemberExportRows(workflowRows, { query: "API", status: "active" });
    assert.deepEqual(filtered.map((member) => member.id), ["20261018000000-m000001"]);
    assert.deepEqual(workflowRows.map((member) => member.id), [
        "20261018000000-m000001",
        "20261018000000-m000002",
    ]);
});

test("组织成员工作流筛选：查询覆盖姓名、部门、职位、状态和备注，忽略大小写", () => {
    assert.equal(matchesOrganizationMemberQuery(workflowRows[0], "张"), true);
    assert.equal(matchesOrganizationMemberQuery(workflowRows[0], "研发"), true);
    assert.equal(matchesOrganizationMemberQuery(workflowRows[0], "工程师"), true);
    assert.equal(matchesOrganizationMemberQuery(workflowRows[0], "核心成员"), true);
    assert.equal(matchesOrganizationMemberQuery(workflowRows[0], "维护"), true);
    assert.equal(matchesOrganizationMemberQuery(workflowRows[0], "API"), true);
    assert.equal(matchesOrganizationMemberQuery(workflowRows[0], "不存在"), false);
    assert.deepEqual(filterOrganizationMemberExportRows(workflowRows, { status: "former" }).map((member) => member.personName), ["李四"]);
});
