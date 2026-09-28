/**
 * 字段契约：人脉主库的全部预设字段。
 * 这里是唯一事实源——初始化向导、仓储层、UI 都从这里取字段定义；
 * 用户改列名不影响插件（我们记 keyID，不记列名），见 docs/DATA-CONTRACT.md。
 */

/** 思源数据库字段类型（本插件用到的子集，全部经 M0 spike 实证） */
export type AvFieldType =
    | "date"
    | "phone"
    | "email"
    | "text"
    | "url"
    | "select"
    | "mSelect"
    | "checkbox"
    | "relation";

/** 字段稳定键（插件内部标识，永不变更；列名可被用户随意改） */
export type FieldKey =
    | "birthday"
    | "lunarBirthday"
    | "phone"
    | "email"
    | "wechat"
    | "website"
    | "group"
    | "tags"
    | "related";

export interface FieldSpec {
    readonly key: FieldKey;
    /** 中文列名（初始化时写入数据库的默认名） */
    readonly nameZh: string;
    /** 英文列名 */
    readonly nameEn: string;
    readonly type: AvFieldType;
    /** relation 字段的双向回链列名 */
    readonly backNameZh?: string;
    readonly backNameEn?: string;
}

/** 主键(block)列由建库自带，不在预设清单里 */
export const FIELD_SPECS: readonly FieldSpec[] = [
    { key: "birthday", nameZh: "生日", nameEn: "Birthday", type: "date" },
    { key: "lunarBirthday", nameZh: "农历生日", nameEn: "Lunar birthday", type: "checkbox" },
    { key: "phone", nameZh: "电话", nameEn: "Phone", type: "phone" },
    { key: "email", nameZh: "邮箱", nameEn: "Email", type: "email" },
    { key: "wechat", nameZh: "微信", nameEn: "WeChat", type: "text" },
    { key: "website", nameZh: "网站", nameEn: "Website", type: "url" },
    { key: "group", nameZh: "分组", nameEn: "Group", type: "select" },
    { key: "tags", nameZh: "标签", nameEn: "Tags", type: "mSelect" },
    {
        key: "related", nameZh: "相关人", nameEn: "Related", type: "relation",
        backNameZh: "被相关人", backNameEn: "Related by",
    },
] as const;

export function fieldSpec(key: FieldKey): FieldSpec {
    const spec = FIELD_SPECS.find((item) => item.key === key);
    if (!spec) throw new Error(`未知字段键: ${key}`);
    return spec;
}

/* ---------- 现有列 ↔ 字段契约的对账（初始化续建 / 设置健康检查共用） ---------- */

/** 数据库列的最小结构（api 层的 AvColumn 结构兼容；domain 不反向依赖 api） */
export interface AvColumnLike {
    readonly id: string;
    readonly name: string;
    readonly type: string;
}

export interface FieldReconcileResult {
    /** 已匹配到的字段 → 列 ID；缺的键不在对象里 */
    fieldMap: Partial<Record<FieldKey, string>>;
    matched: number;
    /** 未匹配到列的字段（按 FIELD_SPECS 顺序） */
    missing: readonly FieldSpec[];
    /** relation 的双向回链列是否已存在（存在即视为双向已配置） */
    backRelationExists: boolean;
    /** 数据库当前最后一列 ID（续建追加字段时的 previousKeyID） */
    lastColumnId: string;
}

/**
 * 把数据库现有列对回字段契约。优先沿用已知 keyID（同类型），否则按默认列名
 * （中文或英文）＋类型匹配；每列只允许绑定一个字段，类型不符不匹配。
 * 初始化续建据此跳过已建列，避免重名列叠加（v3.8.5 实测重复 keyName 不报错但会叠加）。
 */
export function reconcileFieldMap(
    columns: readonly AvColumnLike[],
    current: Partial<Record<FieldKey, string>> = {},
): FieldReconcileResult {
    const fieldMap: Partial<Record<FieldKey, string>> = {};
    const used = new Set<string>();
    const missing: FieldSpec[] = [];
    let matched = 0;
    for (const spec of FIELD_SPECS) {
        const byId = columns.find((column) =>
            !used.has(column.id) && column.id === current[spec.key] && column.type === spec.type,
        );
        const byDefaultName = columns.find((column) =>
            !used.has(column.id) &&
            column.type === spec.type &&
            (column.name === spec.nameZh || column.name === spec.nameEn),
        );
        const column = byId ?? byDefaultName;
        if (!column) {
            missing.push(spec);
            continue;
        }
        fieldMap[spec.key] = column.id;
        used.add(column.id);
        matched += 1;
    }
    const backRelationExists = columns.some((column) =>
        column.type === "relation" &&
        (column.name === fieldSpec("related").backNameZh || column.name === fieldSpec("related").backNameEn));
    return {
        fieldMap,
        matched,
        missing,
        backRelationExists,
        lastColumnId: columns.at(-1)?.id ?? "",
    };
}
