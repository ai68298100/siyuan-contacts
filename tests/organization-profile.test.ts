import test from "node:test";
import assert from "node:assert/strict";
import {
    emptyOrganizationProfileDraft,
    normalizeOrganizationProfileDraft,
    organizationTemplateDraft,
    ORGANIZATION_TEMPLATES,
    validateOrganizationProfile,
} from "../src/domain/organization-profile.ts";

test("组织资料名称为必填，模板提供可编辑的内置组织", () => {
    assert.equal(validateOrganizationProfile(emptyOrganizationProfileDraft()).valid, false);
    assert.deepEqual(ORGANIZATION_TEMPLATES.map((item) => item.key), [
        "family", "primary-school", "middle-school", "high-school", "university", "company", "community",
    ]);
    const family = organizationTemplateDraft("family");
    family.name = "我的家庭";
    assert.equal(validateOrganizationProfile(family).valid, true);
});

test("组织资料校验企查查、Logo 和部门层级", () => {
    const draft = organizationTemplateDraft("company");
    draft.name = " 示例公司 ";
    draft.qccUrl = "https://www.qcc.com/firm/abc";
    draft.logoDataUrl = "data:image/png;base64,aGVsbG8=";
    draft.departments = [
        { id: "root", name: "总部", parentId: null, description: "" },
        { id: "rd", name: "研发", parentId: "root", description: "" },
    ];
    draft.customFields = [{ id: "founded", label: "成立年份", value: "2020" }];
    assert.equal(validateOrganizationProfile(draft).valid, true);
    assert.equal(normalizeOrganizationProfileDraft(draft).name, "示例公司");
    draft.qccUrl = "https://example.com/company";
    assert.match(validateOrganizationProfile(draft).errors.join("、"), /企查查/);
    draft.qccUrl = "https://www.qcc.com/firm/abc";
    draft.departments[1].parentId = "missing";
    assert.match(validateOrganizationProfile(draft).errors.join("、"), /上级不存在/);
});

test("组织部门循环和重复自定义标识会被拒绝", () => {
    const draft = organizationTemplateDraft("family");
    draft.name = "家庭";
    draft.departments = [
        { id: "a", name: "A", parentId: "b", description: "" },
        { id: "b", name: "B", parentId: "a", description: "" },
    ];
    draft.customFields = [{ id: "x", label: "一", value: "" }, { id: "x", label: "二", value: "" }];
    const result = validateOrganizationProfile(draft);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("、"), /循环/);
    assert.match(result.errors.join("、"), /标识重复/);
});
