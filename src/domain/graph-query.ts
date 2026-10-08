import { buildGraph, buildOrgAugmentation, capGraph, compareGraphIds, GRAPH_MAX_NODES, orderGraph, queryGraphRelations } from "./graph.ts";
import { secondDegreeGraphIds, shortestGraphPath } from "./graph-path.ts";
import type { GraphNode, PersonGraph } from "./graph.ts";
import type { ContactSummary } from "./person.ts";
import type { OrgMembership } from "./org-membership.ts";
import type { GraphQueryKind } from "./graph-export.ts";

export type GraphReadStatus = "verified" | "unknown";
export type GraphSourceKey = "roster" | "organizations" | "self" | "references";
export type GraphScope = "global" | "self" | "person" | "org";

export interface GraphOrganization {
    docId: string;
    name: string;
    archived: boolean;
    memberships: readonly Pick<OrgMembership, "personDocId" | "status">[];
}

export interface GraphSources {
    people: readonly ContactSummary[];
    organizations: readonly GraphOrganization[];
    selfDocId: string | null;
    status: Record<Exclude<GraphSourceKey, "references">, GraphReadStatus>;
    errors: Partial<Record<GraphSourceKey, string>>;
    revision: number;
}

export interface GraphQuery {
    mode: "relations" | "native";
    scope: GraphScope;
    centerDocId: string;
    orgDocId: string;
    search: string;
    group: string;
    isolatedOnly: boolean;
    showOrgs: boolean;
    depth: "direct" | "second";
    focusId: string;
    compareId: string;
    queryMode: "common" | "path";
    maxNodes?: number;
}

export interface GraphDiagnostic {
    code: string;
    id?: string;
    message: string;
}

export interface GraphCenter {
    status: "none" | "verified" | "missing" | "unknown";
    id: string;
    label: string;
}

export interface GraphReferenceSource {
    status: GraphReadStatus;
    graph: PersonGraph;
    error?: string;
}

export interface GraphQuerySnapshot {
    query: GraphQuery;
    revision: number;
    state: "ready" | "partial" | "unknown" | "center_missing" | "empty";
    center: GraphCenter;
    sourceStatus: Record<GraphSourceKey, GraphReadStatus>;
    people: ContactSummary[];
    organizations: GraphNode[];
    graph: PersonGraph;
    relationGraph: PersonGraph;
    counts: {
        registered: number | null;
        sourceNodes: number | null;
        sourceEdges: number | null;
        rangeNodes: number;
        rangeEdges: number;
        filteredNodes: number;
        filteredEdges: number;
        displayedNodes: number;
        displayedEdges: number;
        rangeExcluded: number | null;
        filterExcluded: number;
        clippedNodes: number;
        clippedEdges: number;
        isolatedPeople: number;
    };
    truncated: boolean;
    retainedByRange: string[];
    retainedByFilter: string[];
    diagnostics: GraphDiagnostic[];
    result: {
        kind: GraphQueryKind;
        status: "none" | "ready" | "no_path" | "center_missing" | "unknown";
        ids: string[];
        pathIds: string[];
        neighborIds: string[];
        reason: string;
    };
}

function duplicateIds(ids: readonly string[]): Set<string> {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of ids) {
        if (seen.has(id)) duplicates.add(id);
        seen.add(id);
    }
    return duplicates;
}

export function graphRegistry(sources: GraphSources): { people: ContactSummary[]; organizations: GraphNode[]; graph: PersonGraph; diagnostics: GraphDiagnostic[] } {
    const diagnostics: GraphDiagnostic[] = [];
    const rawPeople = sources.status.roster === "verified" ? sources.people : [];
    const knownOrgs = sources.status.organizations === "verified" ? sources.organizations : [];
    const rawOrgs = knownOrgs.filter((org) => !org.archived);
    const duplicateDocs = duplicateIds(rawPeople.map((person) => person.docId));
    const duplicateItems = duplicateIds(rawPeople.map((person) => person.itemId));
    const duplicateOrgs = duplicateIds(knownOrgs.map((org) => org.docId));
    const rawPersonIds = new Set(rawPeople.map((person) => person.docId));
    const overlapping = new Set(knownOrgs.filter((org) => rawPersonIds.has(org.docId)).map((org) => org.docId));
    for (const id of new Set([...duplicateDocs, ...duplicateItems, ...duplicateOrgs, ...overlapping])) {
        diagnostics.push({ code: "ambiguous_identity", id, message: `身份重复或冲突：${id}，该目标不进入图查询。` });
    }
    const people = rawPeople.filter((person) => !duplicateDocs.has(person.docId) && !duplicateItems.has(person.itemId) && !overlapping.has(person.docId))
        .map((person) => ({ ...person, tags: [...person.tags], relatedItemIds: [...person.relatedItemIds] }))
        .sort((left, right) => compareGraphIds(left.docId, right.docId));
    const personIds = new Set(people.map((person) => person.docId));
    const orgs = rawOrgs.filter((org) => !duplicateOrgs.has(org.docId) && !overlapping.has(org.docId));
    for (const org of orgs) {
        for (const member of org.memberships) {
            if (member.status === "active" && !personIds.has(member.personDocId)) {
                diagnostics.push({ code: "dangling_member", id: member.personDocId, message: `组织 ${org.docId} 的成员 ${member.personDocId} 未唯一登记，未生成成员边。` });
            }
        }
    }
    const overlay = buildOrgAugmentation(orgs.map((org) => ({
        docId: org.docId, name: org.name, memberDocIds: org.memberships.filter((member) => member.status === "active").map((member) => member.personDocId),
    })), personIds);
    const related = buildGraph(people);
    return { people, organizations: overlay.nodes.sort((left, right) => compareGraphIds(left.id, right.id)),
        graph: orderGraph({ nodes: [...related.nodes, ...overlay.nodes], edges: [...related.edges, ...overlay.edges] }), diagnostics };
}

export function resolveGraphCenter(sources: GraphSources, query: GraphQuery): GraphCenter {
    return resolveRegistryCenter(sources, query, graphRegistry(sources));
}

function resolveRegistryCenter(sources: GraphSources, query: GraphQuery, registry: ReturnType<typeof graphRegistry>): GraphCenter {
    if (query.scope === "global") return { status: "none", id: "", label: "全部登记文档" };
    const { people, organizations } = registry;
    const isOrg = query.scope === "org";
    const id = query.scope === "self" ? sources.selfDocId ?? "" : isOrg ? query.orgDocId : query.centerDocId;
    const unknown = sources.status.roster === "unknown" || (query.scope === "self" && sources.status.self === "unknown")
        || (isOrg && sources.status.organizations === "unknown");
    const node = isOrg ? organizations.find((org) => org.id === id) : people.find((person) => person.docId === id);
    return { status: unknown ? "unknown" : node ? "verified" : "missing", id,
        label: node ? "name" in node ? node.name : node.label : query.scope === "self" ? "本人" : isOrg ? "指定组织" : "指定人物" };
}

function subset(graph: PersonGraph, ids: ReadonlySet<string>): PersonGraph {
    return orderGraph({ nodes: graph.nodes.filter((node) => ids.has(node.id)), edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) });
}

export function buildGraphQuerySnapshot(sources: GraphSources, query: GraphQuery, references?: GraphReferenceSource): GraphQuerySnapshot {
    const registry = graphRegistry(sources);
    const center = resolveRegistryCenter(sources, query, registry);
    const diagnostics = [...registry.diagnostics];
    const sourceStatus = { ...sources.status, references: references?.status ?? "unknown" };
    for (const [key, message] of Object.entries(sources.errors)) {
        diagnostics.push({ code: `${key}_unknown`, message: `${key} 来源尚未核实：${message}` });
    }
    if (query.mode === "native" && references?.error) diagnostics.push({ code: "references_unknown", message: `文档引用来源尚未核实：${references.error}` });
    const registeredIds = new Set(registry.graph.nodes.map((node) => node.id));
    const referenceIds = new Set(references?.graph.nodes.map((node) => node.id));
    const sourceGraph = query.mode === "relations" ? registry.graph : orderGraph({
        nodes: registry.graph.nodes.filter((node) => referenceIds.has(node.id)),
        edges: references?.graph.edges.filter((edge) => edge.kind === "ref") ?? [],
    });
    const sourceIds = new Set(sourceGraph.nodes.map((node) => node.id));
    const orgIds = new Set(registry.organizations.map((node) => node.id));
    const selectedOrg = registry.organizations.find((node) => node.id === query.orgDocId);
    const orgUnknown = Boolean(query.orgDocId) && (sources.status.organizations === "unknown" || !selectedOrg);
    const criticalUnknown = sources.status.roster === "unknown" || center.status === "unknown" || orgUnknown
        || (query.mode === "native" && references?.status !== "verified");
    if (center.status === "missing") diagnostics.push({ code: "center_missing", id: center.id, message: `${center.label} 未唯一登记或已失效；原选择已保留，请重新选择或切换全局范围。` });
    if (orgUnknown) diagnostics.push({ code: "org_unknown", id: query.orgDocId, message: "所选组织已归档、不可达或来源尚未核实，未自动扩大范围。" });
    const pins = new Set([center.status === "verified" ? center.id : "", query.mode === "relations" ? query.focusId : "", query.mode === "relations" ? query.compareId : "", selectedOrg?.id ?? ""]
        .filter((id) => registeredIds.has(id)));
    const related = orderGraph({ nodes: registry.graph.nodes.filter((node) => node.kind !== "org"), edges: registry.graph.edges.filter((edge) => edge.kind === "related") });
    const scoped = new Set(sourceGraph.nodes.map((node) => node.id));
    if (query.mode === "relations" && query.scope !== "global") {
        scoped.clear();
        if (center.status === "verified") {
            scoped.add(center.id);
            if (query.scope === "org") {
                for (const edge of registry.graph.edges) if (edge.kind === "member" && (edge.source === center.id || edge.target === center.id)) scoped.add(edge.source === center.id ? edge.target : edge.source);
            } else {
                for (const id of queryGraphRelations(related, center.id).neighborIds) scoped.add(id);
                if (query.depth === "second") for (const id of secondDegreeGraphIds(related, center.id)) scoped.add(id);
                if (query.showOrgs) for (const edge of registry.graph.edges) {
                    if (edge.kind !== "member") continue;
                    const orgId = orgIds.has(edge.source) ? edge.source : edge.target;
                    const personId = orgId === edge.source ? edge.target : edge.source;
                    if (scoped.has(personId)) scoped.add(orgId);
                }
            }
        }
    }
    if (selectedOrg) {
        const members = new Set(registry.graph.edges.filter((edge) => edge.kind === "member" && (edge.source === selectedOrg.id || edge.target === selectedOrg.id))
            .map((edge) => edge.source === selectedOrg.id ? edge.target : edge.source));
        for (const id of scoped) if (!members.has(id) && id !== selectedOrg.id) scoped.delete(id);
    }
    const retainedByRange = [...pins].filter((id) => !scoped.has(id)).sort(compareGraphIds);
    for (const id of pins) scoped.add(id);
    const supplemented = orderGraph({ nodes: [...sourceGraph.nodes, ...registry.graph.nodes.filter((node) => pins.has(node.id) && !sourceIds.has(node.id))], edges: sourceGraph.edges });
    const rangeGraph = subset(supplemented, scoped);
    const needle = query.search.trim().toLowerCase();
    const isolated = new Set(related.nodes.filter((node) => node.degree === 0).map((node) => node.id));
    const byPerson = new Map(registry.people.map((person) => [person.docId, person]));
    const retainedByFilter: string[] = [];
    const filteredIds = new Set(rangeGraph.nodes.filter((node) => {
        const person = byPerson.get(node.id);
        const matchesSearch = !needle || (query.mode === "native" ? `${node.label} ${node.id}` : person ? [person.name, person.phone, person.wechat, person.email, ...person.tags].join(" ") : node.label).toLowerCase().includes(needle);
        const matches = matchesSearch && (query.mode === "native" || ((!query.group || person?.group === query.group)
            && (!query.isolatedOnly || isolated.has(node.id)) && (node.kind !== "org" || query.showOrgs)));
        if (!matches && pins.has(node.id)) retainedByFilter.push(node.id);
        return matches || pins.has(node.id);
    }).map((node) => node.id));
    const filtered = subset(rangeGraph, filteredIds);
    let capped = { graph: { nodes: [], edges: [] } as PersonGraph, truncated: false };
    let budgetUnknown = false;
    if (!criticalUnknown && center.status !== "missing") {
        try { capped = capGraph(filtered, query.maxNodes ?? GRAPH_MAX_NODES, [...pins]); }
        catch (error) { budgetUnknown = true; diagnostics.push({ code: "budget_unknown", message: error instanceof Error ? error.message : String(error) }); }
    }
    const graph = capped.graph;
    const relationGraph = orderGraph({ nodes: graph.nodes.filter((node) => node.kind !== "org"), edges: graph.edges.filter((edge) => edge.kind === "related") });
    const relations = queryGraphRelations(relationGraph, query.focusId, query.compareId);
    const kind = query.compareId ? query.queryMode === "path" ? "path" : "common" : query.depth === "second" ? "second" : "direct";
    const pathIds = kind === "path" ? shortestGraphPath(relationGraph, query.focusId, query.compareId) : [];
    const resultIds = kind === "path" ? pathIds : kind === "common" ? relations.commonIds : kind === "second" ? secondDegreeGraphIds(relationGraph, query.focusId) : relations.neighborIds;
    const invalidQueryCenter = Boolean(query.focusId) && (!relationGraph.nodes.some((node) => node.id === query.focusId)
        || Boolean(query.compareId) && !relationGraph.nodes.some((node) => node.id === query.compareId));
    const incomplete = sources.status.organizations === "unknown" || sources.status.self === "unknown" || diagnostics.length > 0;
    const state = center.status === "missing" ? "center_missing" : criticalUnknown || budgetUnknown ? "unknown" : incomplete ? "partial" : graph.nodes.length === 0 ? "empty" : "ready";
    const resultStatus = query.mode === "native" || !query.focusId ? "none" : state === "unknown" ? "unknown" : invalidQueryCenter ? "center_missing" : kind === "path" && !pathIds.length ? "no_path" : "ready";
    const reason = resultStatus === "unknown" ? "查询来源尚未核实，不能判定关系结果。" : resultStatus === "center_missing" ? "关系查询端点已失效或未唯一登记，请重新选择。"
        : resultStatus === "no_path" ? capped.truncated || rangeGraph.nodes.length !== filtered.nodes.length ? "当前筛选或裁剪后的 related 图中未找到路径，可清除筛选或收窄范围后核实。" : "当前范围的 related 图中没有路径，不代表现实中没有关系。"
        : query.mode === "native" ? "文档引用图只展示 ref，不执行 related 人物关系查询。" : !query.focusId ? "尚未选择关系查询中心。" : "关系查询仅使用当前展示图中的显式 related 边。";
    const totalKnown = sources.status.roster === "verified" && sources.status.organizations === "verified";
    const sourceKnown = totalKnown && (query.mode === "relations" || references?.status === "verified");
    return { query: { ...query }, revision: sources.revision, state, center, sourceStatus, people: registry.people, organizations: registry.organizations,
        graph, relationGraph, diagnostics: diagnostics.sort((left, right) => compareGraphIds(`${left.code}:${left.id ?? ""}:${left.message}`, `${right.code}:${right.id ?? ""}:${right.message}`)),
        truncated: capped.truncated, retainedByRange, retainedByFilter: retainedByFilter.sort(compareGraphIds),
        counts: { registered: totalKnown ? registeredIds.size : null, sourceNodes: sourceKnown ? supplemented.nodes.length : null,
            sourceEdges: sourceKnown ? supplemented.edges.length : null, rangeNodes: rangeGraph.nodes.length, rangeEdges: rangeGraph.edges.length,
            filteredNodes: filtered.nodes.length, filteredEdges: filtered.edges.length, displayedNodes: graph.nodes.length, displayedEdges: graph.edges.length,
            rangeExcluded: sourceKnown ? supplemented.nodes.length - rangeGraph.nodes.length : null, filterExcluded: rangeGraph.nodes.length - filtered.nodes.length,
            clippedNodes: capped.truncated ? filtered.nodes.length - graph.nodes.length : 0, clippedEdges: capped.truncated ? filtered.edges.length - graph.edges.length : 0,
            isolatedPeople: isolated.size },
        result: { kind, status: resultStatus, ids: [...resultIds].sort(compareGraphIds), pathIds, neighborIds: relations.neighborIds, reason } };
}

export function graphEdgeLabel(kind: "related" | "member" | "ref" | undefined): string {
    return kind === "member" ? "组织成员（member）" : kind === "ref" ? "文档块引用（ref）" : "显式人物关系（related）";
}
