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
