import type { Plugin } from "siyuan";
import type { ContactsSettings } from "../domain/model";
import type { ContactSummary } from "../domain/person";
import { projectPersonAffiliations } from "../domain/org-membership";
import { projectPersonRelationshipLabels } from "../domain/person-relationship-labels";
import type { PersonRelationshipLabels } from "../domain/person-relationship-labels";
import { loadOrgMembershipStore } from "../data/org-membership";
import { loadRelationshipLabelStore, retainUnknownRelationshipLabelWrite, saveRelationshipLabels } from "../data/person-relationship-labels";
import { loadSelfIdentity, SELF_IDENTITY_STORAGE_KEY } from "../data/self-identity";
import { withStoreLock } from "../data/storage";
import { MigrationWriteUnknownError } from "../domain/migration-records";
import { getRoster, invalidateRoster } from "./roster";
import { scanOrganizations } from "./org";
import { documentExists } from "../api/blocks";
import { mapBoundDocIds } from "../api/av";
import type { SelfIdentity } from "../domain/self-identity";

let profilePlugin: Plugin | undefined;
const profileLifetimes = new WeakMap<Plugin, { active: boolean }>();
const pendingLabelReferences = new WeakMap<Plugin, Map<string, RelationshipLabelReferences>>();

function retainPendingLabelReferences(plugin: Plugin, personDocId: string, references: RelationshipLabelReferences): void {
    const pending = pendingLabelReferences.get(plugin) ?? new Map<string, RelationshipLabelReferences>();
    pending.set(personDocId, references);
    pendingLabelReferences.set(plugin, pending);
}

export function bindPeopleProfileStorage(plugin: Plugin | undefined): () => void {
    if (profilePlugin) {
        const previous = profileLifetimes.get(profilePlugin);
        if (previous) previous.active = false;
    }
    profilePlugin = plugin;
    if (!plugin) return () => {};
    const lifetime = { active: true };
    profileLifetimes.set(plugin, lifetime);
    return () => {
        lifetime.active = false;
        if (profileLifetimes.get(plugin) === lifetime && profilePlugin === plugin) profilePlugin = undefined;
    };
}

export function capturePeopleProfileLifetime(plugin: Plugin): () => void {
    const lifetime = profileLifetimes.get(plugin);
    return () => {
        if (lifetime && (!lifetime.active || profileLifetimes.get(plugin) !== lifetime)) {
            throw new Error("人脉插件生命周期已结束，未执行剩余称谓写入");
        }
    };
}

export async function enrichContactProfiles(people: ContactSummary[], plugin = profilePlugin): Promise<ContactSummary[]> {
    if (!plugin) return people;
    const [affiliations, relationship] = await Promise.allSettled([
        Promise.all([scanOrganizations(), loadOrgMembershipStore(plugin)]),
        Promise.all([loadSelfIdentity(plugin), loadRelationshipLabelStore(plugin)]),
    ]);
    const readAt = Date.now();
    const counts = new Map<string, number>();
    for (const person of people) counts.set(person.docId, (counts.get(person.docId) ?? 0) + 1);
    const organizationMap = affiliations.status === "fulfilled" ? new Map(affiliations.value[0].map((organization) => [organization.docId, organization])) : null;
    const identity = relationship.status === "fulfilled" ? relationship.value[0] : undefined;
    const self = identity ? people.filter((person) => person.docId === identity.selfDocId) : [];
    const selfDocId = identity === null ? null : identity && self.length === 1 && self[0].itemId === identity.selfItemId ? identity.selfDocId : undefined;
    return people.map((person) => ({ ...person, profile: {
        readAt, selfDocId,
        affiliations: affiliations.status === "fulfilled" ? { state: "known" as const, value: projectPersonAffiliations(person.docId, affiliations.value[1].memberships, organizationMap!) }
            : { state: "unknown" as const, message: "组织归属读取失败，请重新读取核实" },
        relationship: relationship.status === "fulfilled" && counts.get(person.docId) === 1
            ? projectPersonRelationshipLabels(relationship.value[1], selfDocId, person.docId) : { state: "unknown" as const, labels: null },
        relationshipMessage: relationship.status === "rejected" || selfDocId === undefined ? "本人参照或称谓读取未核实" : undefined,
    } }));
}

export interface RelationshipLabelEditorState {
    selfDocId: string | null;
    record: PersonRelationshipLabels | null;
}

export interface RelationshipLabelReferences {
    identity: SelfIdentity | null;
    reachable: ReadonlySet<string>;
    itemIds: ReadonlyMap<string, string>;
    assertActive: () => void;
    anchors: string;
}

export async function verifyRelationshipLabelReferences(
    plugin: Plugin, settings: ContactsSettings, personDocIds: readonly string[], expected?: RelationshipLabelReferences,
): Promise<RelationshipLabelReferences> {
    const assertActive = expected?.assertActive ?? capturePeopleProfileLifetime(plugin);
    assertActive();
    const anchors = JSON.stringify([settings.notebookId, settings.avId, settings.dbBlockId, settings.fieldMap]);
    if (expected && expected.anchors !== anchors) throw new Error("称谓原数据库锚点或字段映射已变化，未核实或转移原请求");
    const identity = await loadSelfIdentity(plugin);
    if (expected && JSON.stringify(identity) !== JSON.stringify(expected.identity)) {
        throw new Error("本人参照已变化，未转移旧参照称谓");
    }
    assertActive();
    if (!identity) return { identity: null, reachable: new Set(), itemIds: new Map(), assertActive, anchors };
    invalidateRoster();
    const people = await getRoster(settings);
    const byDocId = new Map<string, ContactSummary[]>();
    for (const person of people) {
        const entries = byDocId.get(person.docId) ?? [];
        entries.push(person);
        byDocId.set(person.docId, entries);
    }
    const candidates = [...new Set([identity.selfDocId, ...personDocIds])].filter((docId) => {
        const entries = byDocId.get(docId);
        return /^\d{14}-[a-z0-9]{7}$/.test(docId) && entries?.length === 1
            && (docId !== identity.selfDocId || entries[0].itemId === identity.selfItemId);
    });
    const itemIds = new Map<string, string>();
    for (let start = 0; start < candidates.length; start += 20) {
        const chunk = candidates.slice(start, start + 20);
        const mapping = await mapBoundDocIds(settings.avId, chunk);
        const exists = await Promise.all(chunk.map((docId) => documentExists(docId)));
        chunk.forEach((docId, index) => {
            const itemId = byDocId.get(docId)![0].itemId;
            if (exists[index] && mapping[docId] === itemId) itemIds.set(docId, itemId);
        });
    }
    if (expected && [...expected.itemIds].some(([docId, itemId]) => itemIds.get(docId) !== itemId)) {
        throw new Error("称谓原参照文档不可达或绑定已变化，结果尚未核实");
    }
    assertActive();
    return { identity, reachable: new Set(itemIds.keys()), itemIds, assertActive, anchors };
}

async function verifiedReferences(
    plugin: Plugin, settings: ContactsSettings, personDocId: string, expectedSelfDocId?: string, expected?: RelationshipLabelReferences,
) {
    const references = await verifyRelationshipLabelReferences(plugin, settings, [personDocId], expected);
    const identity = references.identity;
    if (!identity) {
        if (expectedSelfDocId) throw new Error("本人已清除，未保存称谓");
        return references;
    }
    if (expectedSelfDocId && identity.selfDocId !== expectedSelfDocId) throw new Error("本人已更换，请重新读取；未转移或保存旧参照称谓");
    if (identity.selfDocId === personDocId) throw new Error("本人自身不设置与我的关系称谓");
    if (!references.reachable.has(identity.selfDocId) || !references.reachable.has(personDocId)) {
        throw new Error("本人或人物文档不可达或未唯一绑定当前名册，未按姓名猜测称谓归属");
    }
    return references;
}

export async function loadPersonRelationshipLabels(plugin: Plugin, settings: ContactsSettings, personDocId: string): Promise<RelationshipLabelEditorState> {
    const assertActive = capturePeopleProfileLifetime(plugin);
    return withStoreLock(SELF_IDENTITY_STORAGE_KEY, async () => {
        assertActive();
        const pending = pendingLabelReferences.get(plugin)?.get(personDocId);
        const expected = pending ? { ...pending, assertActive } : undefined;
        const { identity } = await verifiedReferences(plugin, settings, personDocId, pending?.identity?.selfDocId, expected);
        const store = await loadRelationshipLabelStore(plugin);
        assertActive();
        pendingLabelReferences.get(plugin)?.delete(personDocId);
        return { selfDocId: identity?.selfDocId ?? null, record: identity ? store.labels.find((record) => record.selfDocId === identity.selfDocId && record.personDocId === personDocId) ?? null : null };
    });
}

export async function savePersonRelationshipLabels(
    plugin: Plugin, settings: ContactsSettings, personDocId: string, selfDocId: string, labels: string[], expected: PersonRelationshipLabels | null,
): Promise<PersonRelationshipLabels> {
    if (!/^\d{14}-[a-z0-9]{7}$/.test(selfDocId) || !/^\d{14}-[a-z0-9]{7}$/.test(personDocId)) throw new Error("称谓参照文档 ID 非法");
    const assertActive = capturePeopleProfileLifetime(plugin);
    return withStoreLock(SELF_IDENTITY_STORAGE_KEY, async () => {
        assertActive();
        const references = await verifiedReferences(plugin, settings, personDocId, selfDocId);
        assertActive();
        let record: PersonRelationshipLabels;
        try { record = await saveRelationshipLabels(plugin, selfDocId, personDocId, labels, expected, assertActive); }
        catch (error) {
            if (error instanceof MigrationWriteUnknownError) retainPendingLabelReferences(plugin, personDocId, references);
            throw error;
        }
        try {
            await verifiedReferences(plugin, settings, personDocId, selfDocId, references);
            assertActive();
        }
        catch (cause) {
            retainUnknownRelationshipLabelWrite(plugin, record);
            retainPendingLabelReferences(plugin, personDocId, references);
            throw new MigrationWriteUnknownError(cause);
        }
        return record;
    });
}
