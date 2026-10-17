import test from "node:test";
import assert from "node:assert/strict";
import {
    buildPersonFieldsDom, emptyPersonFields, filterPersonFields, MAX_PERSON_FIELDS_ITEMS, MAX_PERSON_FIELDS_JSON_LENGTH,
    normalizePersonFields, parsePersonFieldsBlock, personFieldsKey, removePersonField,
} from "../src/domain/person-fields.ts";
import type { PersonField, PersonFieldsSnapshot } from "../src/domain/person-fields.ts";

const docId = "20261017000000-person1";
const blockId = "20261017000000-fields1";
const groupId = "11111111-1111-4111-8111-111111111111";
const entryId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const secondGroupId = "44444444-4444-4444-8444-444444444444";
const sample = (): PersonFieldsSnapshot => ({ schemaVersion: 1, ownerDocId: docId, items: [
    { id: groupId, kind: "group", label: "联系方式" },
    { id: entryId, kind: "entry", label: "电话", value: "  工作号码\n第二行  ", parentId: groupId },
    { id: otherId, kind: "entry", label: "电话", value: "  工作号码\n第二行  " },
] });
const block = (content: string) => ({ id: blockId, type: "p", content, format: "1" });

test("补充资料规范化只修整名称和换行，允许同名称同值与已知空值", () => {
    const raw = sample();
    raw.items[1].label = "  电话  ";
    if (raw.items[1].kind === "entry") raw.items[1].value = "  值\r\n\r第三行\t  ";
    raw.items.push({ id: secondGroupId, kind: "entry", label: "留空", value: "" });
    const normalized = normalizePersonFields(raw, docId);
    assert.equal(normalized.items[1].label, "电话");
    assert.equal(normalized.items[1].kind === "entry" && normalized.items[1].value, "  值\n\n第三行\t  ");
    assert.equal(raw.items[1].label, "  电话  ", "规范化不能修改调用方草稿");
    assert.equal(normalized.items.length, 4);
    assert.deepEqual(emptyPersonFields(docId), { schemaVersion: 1, ownerDocId: docId, items: [] });
});

test("补充资料原生 DOM 单段落往返保留引号、HTML、Markdown 与字面转义", () => {
    const snapshot = sample();
    if (snapshot.items[1].kind === "entry") snapshot.items[1].value = '<script>&amp; "\'\\n\n{: custom-lvct-person-fields="fake"}\n- [ ] 😀';
    const dom = buildPersonFieldsDom(snapshot, blockId);
    assert.equal((dom.match(/data-node-id=/g) ?? []).length, 1);
    assert.equal((dom.match(/<br \/>/g) ?? []).length, 1, "值中的换行必须留在单行 JSON 内");
    assert.ok(dom.includes('&lt;script&gt;&amp;amp;'));
    assert.ok(dom.includes('custom-lvct-person-fields-format="1"'));
    assert.ok(!dom.includes("<script>"));
    const json = dom.match(/<br \/>([\s\S]*)<\/div><\/div>$/)![1].replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
    assert.deepEqual(parsePersonFieldsBlock(block(`补充资料\n${json}`), docId), snapshot);
    const emptyDom = buildPersonFieldsDom(emptyPersonFields(docId), blockId);
    assert.ok(emptyDom.includes("&quot;items&quot;:[]"), "空快照仍应生成持久段落");
});

test("补充资料 canonical key 固定属性顺序、保留条目顺序与稳定 UUID", () => {
    const source = sample();
    const reorderedObject = { items: source.items.map((item) => ({ ...item })), ownerDocId: docId, schemaVersion: 1 };
    assert.equal(personFieldsKey(normalizePersonFields(reorderedObject, docId)), personFieldsKey(source));
    const differentOrder = { ...source, items: [...source.items].reverse() };
    assert.notEqual(personFieldsKey(differentOrder), personFieldsKey(source));
    const uppercase = { ...source, items: source.items.map((item) => ({ ...item, id: item.id.toUpperCase() })) };
    assert.equal(personFieldsKey(normalizePersonFields(uppercase, docId)), personFieldsKey(source));
});

test("补充资料拒绝未知字段、坏容器、未知版本、重复身份与非 UUID v4", () => {
    for (const raw of [null, [], "{}", {}, { ...sample(), schemaVersion: 2 }, { ...sample(), extra: true },
        { ...sample(), items: [...sample().items, sample().items[1]] },
        { ...sample(), items: [{ id: "22222222-2222-1222-8222-222222222222", kind: "entry", label: "电话", value: "" }] },
        { ...sample(), items: [{ ...sample().items[0], value: "不允许分组拥有值" }] },
        { ...sample(), items: [{ ...sample().items[1], extra: true }] },
        { ...sample(), items: [{ id: entryId, kind: "entry", label: "电话", value: undefined }] },
        { ...sample(), items: [{ id: entryId, kind: "entry", label: "电话", value: "", parentId: undefined }] },
    ]) assert.throws(() => normalizePersonFields(raw, docId));
    assert.throws(() => normalizePersonFields({ ...sample(), items: new Array(1) }, docId), /缺项/);
    const namedArray = Object.assign([...sample().items], { extra: true });
    assert.throws(() => normalizePersonFields({ ...sample(), items: namedArray }, docId), /未知属性/);
});

test("补充资料原生 JSON 重复字段拒绝，合法属性换序不改变内容", () => {
    const duplicateOwner = `{"schemaVersion":1,"ownerDocId":"20261017000000-person2","ownerDocId":"${docId}","items":[]}`;
    assert.throws(() => parsePersonFieldsBlock(block(`补充资料\n${duplicateOwner}`), docId), /重复字段/);
    const duplicateLabel = `{"schemaVersion":1,"ownerDocId":"${docId}","items":[{"id":"${entryId}","kind":"entry","label":"旧","label":"新","value":""}]}`;
    assert.throws(() => parsePersonFieldsBlock(block(`补充资料\n${duplicateLabel}`), docId), /重复字段/);
    assert.deepEqual(parsePersonFieldsBlock(block(`补充资料\n{ "items": [], "ownerDocId": "${docId}", "schemaVersion": 1 }`), docId), emptyPersonFields(docId));
});

test("补充资料拒绝悬空、子条目作父项、自指和分组循环", () => {
    for (const items of [
        [{ id: entryId, kind: "entry", label: "电话", value: "", parentId: groupId }],
        [{ id: entryId, kind: "entry", label: "电话", value: "" }, { id: otherId, kind: "entry", label: "邮箱", value: "", parentId: entryId }],
        [{ id: entryId, kind: "entry", label: "电话", value: "", parentId: entryId }],
        [{ id: groupId, kind: "group", label: "一", parentId: secondGroupId }, { id: secondGroupId, kind: "group", label: "二", parentId: groupId }],
    ]) assert.throws(() => normalizePersonFields({ ...sample(), items }, docId));
});

test("补充资料 owner 与原生块格式不符时拒绝，不把复制内容认领为新人", () => {
    assert.throws(() => emptyPersonFields("invalid"));
    assert.throws(() => normalizePersonFields(sample(), "20261017000000-person2"), /所属人物/);
    const content = `补充资料\n${personFieldsKey(sample())}`;
    for (const input of [{ ...block(content), format: undefined }, { ...block(content), format: "2" },
        { ...block(content), type: "l" }, { ...block(content), id: docId }, { ...block(content), id: "bad" },
        block(content.replace("补充资料", "其他资料")), block("补充资料\n{bad}"), block(`${content}\n`),
        block(`补充资料\n${" ".repeat(MAX_PERSON_FIELDS_JSON_LENGTH + 1)}`),
    ]) assert.throws(() => parsePersonFieldsBlock(input, docId));
    assert.throws(() => parsePersonFieldsBlock(block(content), "20261017000000-person2"), /所属人物/);
    assert.throws(() => buildPersonFieldsDom(sample(), docId));
});

test("补充资料超限与控制字符整份拒绝，不截断或丢弃条目", () => {
    for (const [label, value] of [[" ", ""], ["字".repeat(81), ""], ["标题\n下一行", ""], ["电话", "字".repeat(2001)],
        ["标题", "值\u0000"], ["标题", "值\u0085"], ["标题", "值\u2028"],
    ]) assert.throws(() => normalizePersonFields({ ...sample(), items: [{ id: entryId, kind: "entry", label, value }] }, docId));
    const makeId = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    assert.throws(() => normalizePersonFields({ ...sample(), items: Array.from({ length: MAX_PERSON_FIELDS_ITEMS + 1 }, (_, index) => ({ id: makeId(index), kind: "entry", label: "项", value: "" })) }, docId), /100 项/);
    assert.throws(() => normalizePersonFields({ ...sample(), items: Array.from({ length: 60 }, (_, index) => ({ id: makeId(index), kind: "entry", label: "项", value: "字".repeat(2000) })) }, docId), /JSON/);
});

test("删除分组显式选择保留或删除子项，其他分组和源草稿不变", () => {
    const source = sample();
    source.items.push({ id: secondGroupId, kind: "group", label: "其他" });
    const kept = removePersonField(source.items, groupId, true);
    assert.deepEqual(kept, [
        { id: entryId, kind: "entry", label: "电话", value: "  工作号码\n第二行  " },
        source.items[2], source.items[3],
    ]);
    assert.deepEqual(removePersonField(source.items, groupId, false), [source.items[2], source.items[3]]);
    assert.deepEqual(removePersonField(source.items, entryId, false), [source.items[0], source.items[2], source.items[3]]);
    assert.equal(source.items.length, 4);
    assert.equal(source.items[1].kind === "entry" && source.items[1].parentId, groupId);
    assert.throws(() => removePersonField(source.items, "55555555-5555-4555-8555-555555555555", true), /不存在/);
});

test("补充资料筛选空关键词保留全部顺序与稳定身份，输出副本不修改输入", () => {
    const source = sample().items;
    source.push({ id: secondGroupId, kind: "group", label: "空分组" });
    const original = structuredClone(source);
    for (const item of source) Object.freeze(item);
    Object.freeze(source);
    const result = filterPersonFields(source, " \t\n ");
    assert.deepEqual(result.items, original);
    assert.equal(result.matchedEntryCount, 2, "只计算条目，不计分组");
    assert.notEqual(result.items, source);
    for (let index = 0; index < source.length; index += 1) assert.notEqual(result.items[index], source[index]);
    result.items[0].label = "只修改展示副本";
    assert.deepEqual(source, original);
});

test("补充资料筛选组名忽略大小写与首尾空白，分组晚于子项仍带全组且保持原顺序", () => {
    const source: PersonField[] = [
        { id: entryId, kind: "entry", label: "电话", value: "工作号码", parentId: groupId },
        { id: secondGroupId, kind: "group", label: "家庭资料" },
        { id: groupId, kind: "group", label: "Work Contacts" },
        { id: otherId, kind: "entry", label: "电话", value: "私人号码", parentId: groupId },
        { id: "55555555-5555-4555-8555-555555555555", kind: "entry", label: "地址", value: "家庭住址", parentId: secondGroupId },
    ];
    const result = filterPersonFields(source, "  WORK contacts  ");
    assert.deepEqual(result.items, [source[0], source[2], source[3]]);
    assert.equal(result.matchedEntryCount, 2);
    assert.equal(source.length, 5);
});

test("补充资料筛选子项名称和值补回组头，仅保留命中子项与顶层重复项", () => {
    const source: PersonField[] = [
        { id: entryId, kind: "entry", label: "Work Phone", value: "11001", parentId: groupId },
        { id: groupId, kind: "group", label: "联系方式" },
        { id: secondGroupId, kind: "entry", label: "邮箱", value: "first@example.test", parentId: groupId },
        { id: otherId, kind: "entry", label: "Work Phone", value: "11001" },
    ];
    const result = filterPersonFields(source, "  work PHONE ");
    assert.deepEqual(result.items, [source[0], source[1], source[3]]);
    assert.equal(result.matchedEntryCount, 2, "同名同值的不同身份不得合并");
    assert.deepEqual(filterPersonFields(source, "FIRST@example.TEST").items, [source[1], source[2]]);
    assert.deepEqual(source.map((item) => item.id), [entryId, groupId, secondGroupId, otherId]);
});

test("补充资料筛选使用完整多行值，不将组头回补误扩展为同组全部条目", () => {
    const source = sample().items;
    if (source[1].kind === "entry") source[1].value = `${"很长的内容".repeat(300)}\nTail-Case\nNext Line`;
    const before = structuredClone(source);
    const result = filterPersonFields(source, "  TAIL-case\nNext LINE ");
    assert.deepEqual(result.items, [source[0], source[1]]);
    assert.equal(result.matchedEntryCount, 1);
    assert.deepEqual(source, before);
});

test("补充资料筛选空组匹配显示组与零条目，无命中为空且不匹配身份元数据", () => {
    const source = sample().items;
    source.push({ id: secondGroupId, kind: "group", label: "Empty Group" });
    assert.deepEqual(filterPersonFields(source, " EMPTY group "), { items: [source[3]], matchedEntryCount: 0 });
    assert.deepEqual(filterPersonFields(source, "不存在的关键词"), { items: [], matchedEntryCount: 0 });
    assert.deepEqual(filterPersonFields(source, groupId), { items: [], matchedEntryCount: 0 });
    assert.deepEqual(filterPersonFields([], ""), { items: [], matchedEntryCount: 0 });
});
