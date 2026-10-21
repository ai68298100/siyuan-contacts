import { test } from "node:test";
import assert from "node:assert/strict";
import {
    extractCityFromAddress,
    isNeedsReconnection,
    groupPeopleByRegion,
    generateTripPlanMarkdown,
    findNearbyOrSameProvinceCities,
    groupContactsByRegion,
    filterContactsByRegion,
    filterPeopleByRegion,
    extractNormalizedRegion,
    type Person
} from "../src/domain/region.ts";

function createMockPerson(partial: Partial<Person>): Person {
    return {
        id: partial.id || "p-" + Math.random().toString(36).slice(2, 7),
        name: partial.name || "测试用户",
        tags: partial.tags || [],
        groups: partial.groups || [],
        ...partial
    };
}

test("extractCityFromAddress: 正确解析直辖市与知名城市", () => {
    assert.deepEqual(extractCityFromAddress("北京市海淀区中关村"), { province: "北京", city: "北京" });
    assert.deepEqual(extractCityFromAddress("上海浦东新区陆家嘴"), { province: "上海", city: "上海" });
    assert.deepEqual(extractCityFromAddress("广东省深圳市南山区高新园"), { province: "广东", city: "深圳" });
    assert.deepEqual(extractCityFromAddress("浙江杭州西湖区"), { province: "浙江", city: "杭州" });
    assert.deepEqual(extractCityFromAddress("四川省成都市高新区天府大道"), { province: "四川", city: "成都" });
    assert.deepEqual(extractCityFromAddress("香港中环国际金融中心"), { province: "香港", city: "香港" });
});

test("extractCityFromAddress: 处理边界条件与无法识别情况", () => {
    assert.equal(extractCityFromAddress(""), null);
    assert.equal(extractCityFromAddress(undefined), null);
    assert.equal(extractCityFromAddress("   "), null);
});

test("isNeedsReconnection: 识别长期未联络联系人", () => {
    const now = new Date("2026-10-20T12:00:00Z").getTime();
    
    // 无联系记录
    const p1 = createMockPerson({ name: "张三", lastContact: undefined });
    assert.equal(isNeedsReconnection(p1, 60, now), true);

    // 10 天前联系过（不需要重新激活）
    const p2 = createMockPerson({ name: "李四", lastContact: "2026-10-10" });
    assert.equal(isNeedsReconnection(p2, 60, now), false);

    // 100 天前联系过（需要重新联络）
    const p3 = createMockPerson({ name: "王五", lastContact: "2026-06-01" });
    assert.equal(isNeedsReconnection(p3, 60, now), true);
});

test("groupPeopleByRegion: 聚合城市与待联络统计", () => {
    const now = new Date("2026-10-20T12:00:00Z").getTime();
    const people: Person[] = [
        createMockPerson({ id: "1", name: "深圳A", address: "广东省深圳市南山区", lastContact: "2026-10-15" }),
        createMockPerson({ id: "2", name: "深圳B", address: "深圳福田区", lastContact: "2026-01-01" }), // 需重联
        createMockPerson({ id: "3", name: "北京A", address: "北京市朝阳区", lastContact: "2026-01-01" }), // 需重联
        createMockPerson({ id: "4", name: "无地址", address: "" })
    ];

    const summary = groupPeopleByRegion(people, 60, now);
    assert.equal(summary.totalPeople, 4);
    assert.equal(summary.totalResolvedPeople, 3);
    assert.equal(summary.unresolvedCount, 1);
    assert.equal(summary.unresolvedPeople[0].name, "无地址");

    assert.equal(summary.cityGroups.length, 2);
    // 深圳有 2 人，排第一
    assert.equal(summary.cityGroups[0].city, "深圳");
    assert.equal(summary.cityGroups[0].count, 2);
    assert.equal(summary.cityGroups[0].needsReconnectionCount, 1);

    // 北京有 1 人，排第二
    assert.equal(summary.cityGroups[1].city, "北京");
    assert.equal(summary.cityGroups[1].count, 1);
    assert.equal(summary.cityGroups[1].needsReconnectionCount, 1);
});

test("generateTripPlanMarkdown: 生成符合格式的出差拜访清单", () => {
    const people: Person[] = [
        createMockPerson({
            name: "李总",
            organization: "未来科技",
            role: "CTO",
            phone: "13800000000",
            wechat: "lizong_wechat",
            lastContact: "2026-08-15",
            tags: ["重要伙伴", "AI方向"]
        })
    ];

    const md = generateTripPlanMarkdown({
        city: "深圳",
        people,
        planDate: "2026-10-25 至 2026-10-28",
        note: "参加大湾区开发者大会并拜访老友"
    });

    assert.ok(md.includes("# 📍 出差拜访清单 - 深圳"));
    assert.ok(md.includes("规划日期"));
    assert.ok(md.includes("未来科技 · CTO"));
    assert.ok(md.includes("13800000000"));
    assert.ok(md.includes("lizong_wechat"));
    assert.ok(md.includes("重要伙伴、AI方向"));
});

test("findNearbyOrSameProvinceCities: 正确查找同省关联城市", () => {
    const nearby = findNearbyOrSameProvinceCities("深圳");
    assert.ok(nearby.includes("广州"));
    assert.ok(nearby.includes("珠海"));
    assert.ok(!nearby.includes("深圳")); // 排除自身
    assert.ok(!nearby.includes("杭州")); // 排除外省
});

test("groupContactsByRegion & filterContactsByRegion: 城市分组与城市筛选", () => {
    const contacts: Person[] = [
        createMockPerson({ id: "p1", name: "张三", tags: ["杭州", "技术顾问"] }),
        createMockPerson({ id: "p2", name: "李四", company: "阿里巴巴（杭州总部）" }),
        createMockPerson({ id: "p3", name: "王五", address: "北京市朝阳区酒仙桥" }),
        createMockPerson({ id: "p4", name: "赵六" }), // 未知
    ];

    const groups = groupContactsByRegion(contacts);
    // 杭州应有 2 人（标签命中 + 公司命中），排第一
    assert.equal(groups[0].city, "杭州");
    assert.equal(groups[0].count, 2);

    const hzPeople = filterContactsByRegion(contacts, "杭州");
    assert.equal(hzPeople.length, 2);
    assert.equal(hzPeople[0].name, "张三");
    assert.equal(hzPeople[1].name, "李四");

    const unknownPeople = filterContactsByRegion(contacts, "未知");
    assert.equal(unknownPeople.length, 1);
    assert.equal(unknownPeople[0].name, "赵六");
});

test("filterPeopleByRegion: 多维地域筛选支持城市、省份与未填写", () => {
    const contacts: Person[] = [
        createMockPerson({ id: "p1", name: "张三", address: "广东省广州市天河区" }),
        createMockPerson({ id: "p2", name: "李四", tags: ["深圳"] }),
        createMockPerson({ id: "p3", name: "王五", tags: ["北京"] }),
        createMockPerson({ id: "p4", name: "赵六" }),
    ];

    // 筛选城市
    const gz = filterPeopleByRegion(contacts, "广州");
    assert.equal(gz.length, 1);
    assert.equal(gz[0].name, "张三");

    // 筛选省份（广东应命中广州和深圳）
    const gd = filterPeopleByRegion(contacts, "广东");
    assert.equal(gd.length, 2);

    // 筛选未填写
    const un = filterPeopleByRegion(contacts, "未填写");
    assert.equal(un.length, 1);
    assert.equal(un[0].name, "赵六");
});
