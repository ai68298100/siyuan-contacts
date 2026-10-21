export interface Person {
    id?: string;
    docId?: string;
    itemId?: string;
    name: string;
    address?: string;
    organization?: string;
    role?: string;
    phone?: string;
    wechat?: string;
    email?: string;
    website?: string;
    lastContact?: string;
    tags?: string[];
    groups?: string[];
    group?: string;
    relationshipLabel?: string;
    company?: string;
    title?: string;
    profile?: any;
    [key: string]: any;
}

export interface RegionCityGroup {
    city: string;
    province?: string;
    count: number;
    people: Person[];
    /** 距离当前时间超过指定天数未联络的人数（默认 60 天） */
    needsReconnectionCount: number;
}

export interface RegionSummary {
    totalPeople: number;
    totalResolvedPeople: number;
    unresolvedCount: number;
    unresolvedPeople: Person[];
    cityGroups: RegionCityGroup[];
}

/** 知名城市到对应省份映射（直辖市和特区省份同名或直辖） */
const KNOWN_CITY_PROVINCE_MAP: Record<string, string> = {
    北京: "北京",
    上海: "上海",
    天津: "天津",
    重庆: "重庆",
    香港: "香港",
    澳门: "澳门",
    台北: "台湾",
    高雄: "台湾",
    // 广东
    广州: "广东",
    深圳: "广东",
    东莞: "广东",
    佛山: "广东",
    珠海: "广东",
    惠州: "广东",
    中山: "广东",
    江门: "广东",
    汕头: "广东",
    湛江: "广东",
    // 浙江
    杭州: "浙江",
    宁波: "浙江",
    温州: "浙江",
    嘉兴: "浙江",
    湖州: "浙江",
    绍兴: "浙江",
    金华: "浙江",
    台州: "浙江",
    衢州: "浙江",
    丽水: "浙江",
    舟山: "浙江",
    // 江苏
    南京: "江苏",
    苏州: "江苏",
    无锡: "江苏",
    常州: "江苏",
    南通: "江苏",
    扬州: "江苏",
    镇江: "江苏",
    徐州: "江苏",
    连云港: "江苏",
    淮安: "江苏",
    盐城: "江苏",
    泰州: "江苏",
    宿迁: "江苏",
    昆山: "江苏",
    // 四川
    成都: "四川",
    绵阳: "四川",
    德阳: "四川",
    宜宾: "四川",
    南充: "四川",
    泸州: "四川",
    乐山: "四川",
    // 湖北
    武汉: "湖北",
    襄阳: "湖北",
    宜昌: "湖北",
    荆州: "湖北",
    黄石: "湖北",
    十堰: "湖北",
    // 湖南
    长沙: "湖南",
    株洲: "湖南",
    湘潭: "湖南",
    衡阳: "湖南",
    岳阳: "湖南",
    常德: "湖南",
    // 陕西
    西安: "陕西",
    宝鸡: "陕西",
    咸阳: "陕西",
    汉中: "陕西",
    延安: "陕西",
    // 山东
    济南: "山东",
    青岛: "山东",
    烟台: "山东",
    潍坊: "山东",
    威海: "山东",
    淄博: "山东",
    临沂: "山东",
    济宁: "山东",
    // 福建
    福州: "福建",
    厦门: "福建",
    泉州: "福建",
    漳州: "福建",
    莆田: "福建",
    // 河南
    郑州: "河南",
    洛阳: "河南",
    南阳: "河南",
    新乡: "河南",
    开封: "河南",
    // 安徽
    合肥: "安徽",
    芜湖: "安徽",
    蚌埠: "安徽",
    安庆: "安徽",
    黄山: "安徽",
    // 江西
    南昌: "江西",
    九江: "江西",
    赣州: "江西",
    景德镇: "江西",
    // 河北
    石家庄: "河北",
    保定: "河北",
    唐山: "河北",
    廊坊: "河北",
    邯郸: "河北",
    雄安: "河北",
    // 辽宁
    沈阳: "辽宁",
    大连: "辽宁",
    鞍山: "辽宁",
    // 吉林
    长春: "吉林",
    吉林市: "吉林",
    // 黑龙江
    哈尔滨: "黑龙江",
    大庆: "黑龙江",
    // 云南
    昆明: "云南",
    大理: "云南",
    丽江: "云南",
    // 贵州
    贵阳: "贵州",
    遵义: "贵州",
    // 广西
    南宁: "广西",
    桂林: "广西",
    柳州: "广西",
    // 海南
    海口: "海南",
    三亚: "海南",
    // 内蒙古
    呼和浩特: "内蒙古",
    包头: "内蒙古",
    // 宁夏
    银川: "宁夏",
    // 新疆
    乌鲁木齐: "新疆",
    // 青海
    西宁: "青海",
    // 甘肃
    兰州: "甘肃",
    // 西藏
    拉萨: "西藏",
    // 海外常用
    新加坡: "新加坡",
    东京: "海外",
    首尔: "海外",
    伦敦: "海外",
    纽约: "海外",
    旧金山: "海外",
    硅谷: "海外",
    西雅图: "海外",
};

const PROVINCES = [
    "北京", "上海", "天津", "重庆", "香港", "澳门", "台湾",
    "广东", "浙江", "江苏", "四川", "湖北", "湖南", "陕西", "山东",
    "福建", "河南", "安徽", "江西", "河北", "辽宁", "吉林", "黑龙江",
    "云南", "贵州", "广西", "海南", "内蒙古", "宁夏", "新疆", "青海", "甘肃", "西藏"
];

/**
 * 从地址字符串中解析出省份与城市
 */
export function extractCityFromAddress(rawAddress: string | undefined): { province?: string; city: string } | null {
    if (!rawAddress) return null;
    const text = rawAddress.trim();
    if (!text) return null;

    // 1. 直辖市 / 特别行政区匹配
    for (const d of ["北京", "上海", "天津", "重庆", "香港", "澳门"]) {
        if (text.startsWith(d) || text.includes(d + "市") || text.includes(d + "特别行政区")) {
            return { province: d, city: d };
        }
    }

    // 2. 遍历已知城市词典进行匹配
    for (const [cityKey, province] of Object.entries(KNOWN_CITY_PROVINCE_MAP)) {
        if (text.includes(cityKey)) {
            return { province, city: cityKey };
        }
    }

    // 3. 通用正则匹配：XX省XX市 或 XX自治区XX市 或 XX市
    const provCityRegex = /([\u4e00-\u9fa5]{2,5}?(?:省|自治区|特别行政区))?\s*([\u4e00-\u9fa5]{2,6}?市)/;
    const match = text.match(provCityRegex);
    if (match) {
        let rawProv = match[1]?.replace(/(省|自治区|特别行政区)$/, "").trim();
        let rawCity = match[2]?.replace(/市$/, "").trim();
        if (rawCity) {
            // 如果提取出来的城市在我们已知映射中，矫正省份
            const mappedProv = KNOWN_CITY_PROVINCE_MAP[rawCity];
            return {
                province: mappedProv || rawProv,
                city: rawCity
            };
        }
    }

    // 4. 省份命中但无具体城市
    for (const prov of PROVINCES) {
        if (text.includes(prov)) {
            return { province: prov, city: prov };
        }
    }

    return null;
}

/**
 * 检查联系人是否长期未联络（如超过 inactiveThresholdDays 天）
 */
export function isNeedsReconnection(person: Person, inactiveThresholdDays = 60, now = Date.now()): boolean {
    if (!person.lastContact) {
        return true;
    }
    const lastTime = new Date(person.lastContact).getTime();
    if (Number.isNaN(lastTime)) {
        return true;
    }
    const diffDays = (now - lastTime) / (1000 * 60 * 60 * 24);
    return diffDays >= inactiveThresholdDays;
}

/**
 * 对联系人列表进行地区聚类和统计
 */
export function groupPeopleByRegion(people: Person[], inactiveThresholdDays = 60, now = Date.now()): RegionSummary {
    const cityMap = new Map<string, RegionCityGroup>();
    const unresolvedPeople: Person[] = [];

    for (const person of people) {
        const resolved = extractCityFromAddress(person.address);
        if (!resolved) {
            unresolvedPeople.push(person);
            continue;
        }

        const cityKey = resolved.city;
        let group = cityMap.get(cityKey);
        if (!group) {
            group = {
                city: cityKey,
                province: resolved.province,
                count: 0,
                people: [],
                needsReconnectionCount: 0
            };
            cityMap.set(cityKey, group);
        }

        group.people.push(person);
        group.count += 1;
        if (isNeedsReconnection(person, inactiveThresholdDays, now)) {
            group.needsReconnectionCount += 1;
        }
    }

    // 按联系人数量降序，数量相同按拼音或名称排
    const cityGroups = Array.from(cityMap.values()).sort((a, b) => {
        if (b.count !== a.count) {
            return b.count - a.count;
        }
        return a.city.localeCompare(b.city, "zh-CN");
    });

    const totalResolvedPeople = people.length - unresolvedPeople.length;

    return {
        totalPeople: people.length,
        totalResolvedPeople,
        unresolvedCount: unresolvedPeople.length,
        unresolvedPeople,
        cityGroups
    };
}

export interface TripPlanMarkdownOptions {
    city: string;
    people: Person[];
    planDate?: string;
    note?: string;
}

/**
 * 生成出差/拜访联络清单的 Markdown 文本，方便快速复制分享到备忘录或思源文档中
 */
export function generateTripPlanMarkdown(options: TripPlanMarkdownOptions): string {
    const { city, people, planDate, note } = options;
    const lines: string[] = [];

    lines.push(`# 📍 出差拜访清单 - ${city}`);
    if (planDate) {
        lines.push(`> **规划日期**：${planDate}`);
    }
    if (note) {
        lines.push(`> **出差备忘**：${note}`);
    }
    lines.push(`> **预计联络人脉**：共 ${people.length} 位`);
    lines.push("");

    if (people.length === 0) {
        lines.push("_暂无选择联系人_");
        return lines.join("\n");
    }

    lines.push("| 姓名 | 组织/职务 | 电话 | 微信 | 最近互动 | 拜访重点/标签 |");
    lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");

    for (const p of people) {
        const orgRole = [p.organization, p.role].filter(Boolean).join(" · ") || "-";
        const phone = p.phone || "-";
        const wechat = p.wechat || "-";
        const lastContact = p.lastContact ? p.lastContact.slice(0, 10) : "未记录";
        const tags = (p.tags && p.tags.length > 0) ? p.tags.join("、") : "-";

        lines.push(`| **${p.name}** | ${orgRole} | ${phone} | ${wechat} | ${lastContact} | ${tags} |`);
    }

    lines.push("");
    lines.push("### 备忘录与纪要要点");
    lines.push("- [ ] 拜访前确认行程安排与会面时间");
    lines.push("- [ ] 准备交流议题与伴手礼/资料");
    lines.push("- [ ] 会后及时录入互动时间线");


    return lines.join("\n");
}

/**
 * 综合联系人的地址、标签、组织单位等线索，提炼出规范化的地域信息
 */
export function extractNormalizedRegion(person: Person): { city: string; province?: string; region?: string } {
    if (!person) return { city: "未知" };

    // 1. 优先从地址字段解析
    if (person.address) {
        const fromAddr = extractCityFromAddress(person.address);
        if (fromAddr) {
            return { city: fromAddr.city, province: fromAddr.province };
        }
    }

    // 2. 从标签中提取城市
    if (Array.isArray(person.tags)) {
        for (const tag of person.tags) {
            const trimmed = tag.trim();
            if (KNOWN_CITY_PROVINCE_MAP[trimmed]) {
                return { city: trimmed, province: KNOWN_CITY_PROVINCE_MAP[trimmed] };
            }
            const fromTag = extractCityFromAddress(trimmed);
            if (fromTag) {
                return { city: fromTag.city, province: fromTag.province };
            }
        }
    }

    // 3. 从公司或组织背景中提取城市
    const orgSources = [
        person.company,
        person.organization,
    ].filter(Boolean) as string[];

    if (person.profile && person.profile.affiliations?.state === "known") {
        const aff = person.profile.affiliations.value;
        const allAffs = [...(aff.work || []), ...(aff.education || []), ...(aff.family || []), ...(aff.unspecified || [])];
        for (const a of allAffs) {
            if (a.orgName) orgSources.push(a.orgName);
        }
    }

    for (const text of orgSources) {
        const fromOrg = extractCityFromAddress(text);
        if (fromOrg) {
            return { city: fromOrg.city, province: fromOrg.province };
        }
    }

    return { city: "未知" };
}

/**
 * 获取同省或周边的关联城市名单
 */
export function findNearbyOrSameProvinceCities(city: string): string[] {
    if (!city || city === "未知") return [];
    const prov = KNOWN_CITY_PROVINCE_MAP[city];
    if (!prov) return [];

    const result: string[] = [];
    for (const [c, p] of Object.entries(KNOWN_CITY_PROVINCE_MAP)) {
        if (p === prov && c !== city) {
            result.push(c);
        }
    }
    return result;
}

/**
 * 对联系人列表进行城市归类分组，供地域对话框和图表消费
 */
export function groupContactsByRegion<T extends Person>(contacts: readonly T[]): { city: string; province?: string; count: number; people: T[] }[] {
    const map = new Map<string, { city: string; province?: string; count: number; people: T[] }>();

    for (const person of contacts) {
        const norm = extractNormalizedRegion(person);
        const cityKey = norm.city;
        let entry = map.get(cityKey);
        if (!entry) {
            entry = {
                city: cityKey,
                province: norm.province,
                count: 0,
                people: [],
            };
            map.set(cityKey, entry);
        }
        entry.people.push(person);
        entry.count += 1;
    }

    const groups = Array.from(map.values());
    // 已知城市排在前面按数量降序，数量相同按名称排序；未知排在最后
    groups.sort((a, b) => {
        if (a.city === "未知") return 1;
        if (b.city === "未知") return -1;
        if (b.count !== a.count) return b.count - a.count;
        return a.city.localeCompare(b.city, "zh-CN");
    });

    return groups;
}

/**
 * 按指定目标城市过滤联系人
 */
export function filterContactsByRegion<T extends Person>(contacts: readonly T[], targetCity: string): T[] {
    if (!targetCity) return [...contacts];
    const target = targetCity.trim().toLowerCase();

    if (target === "未知" || target === "未填写") {
        return contacts.filter((p) => extractNormalizedRegion(p).city === "未知");
    }

    return contacts.filter((p) => {
        const norm = extractNormalizedRegion(p);
        if (norm.city.toLowerCase() === target) return true;
        if (norm.province && norm.province.toLowerCase() === target) return true;
        if (p.address && p.address.toLowerCase().includes(target)) return true;
        return false;
    });
}

/**
 * 供名册过滤器使用的多维地域筛选（支持城市名、省份名或“未填写”）
 */
export function filterPeopleByRegion<T extends Person>(people: readonly T[], regionQuery: string): T[] {
    if (!regionQuery || !regionQuery.trim()) return [...people];
    const q = regionQuery.trim().toLowerCase();

    if (q === "未填写" || q === "未知") {
        return people.filter((p) => extractNormalizedRegion(p).city === "未知");
    }

    return people.filter((p) => {
        const norm = extractNormalizedRegion(p);
        if (norm.city.toLowerCase().includes(q)) return true;
        if (norm.province && norm.province.toLowerCase().includes(q)) return true;
        if (p.address && p.address.toLowerCase().includes(q)) return true;
        if (Array.isArray(p.tags) && p.tags.some((t) => t.toLowerCase().includes(q))) return true;
        if (p.company && p.company.toLowerCase().includes(q)) return true;
        if (p.organization && p.organization.toLowerCase().includes(q)) return true;
        return false;
    });
}

