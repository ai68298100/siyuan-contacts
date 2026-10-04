import { listContacts } from "./contacts";
import { fetchGlobalGraph, fetchLocalGraph } from "../api/graph";
import { graphRegistry, resolveGraphCenter } from "../domain/graph-query";
import { mapNativeGraph } from "../domain/native-graph";
import type { ContactsSettings } from "../domain/model";
import type { GraphOrganization, GraphQuery, GraphReferenceSource, GraphSources } from "../domain/graph-query";

export async function loadGraphSources(settings: ContactsSettings, reads: {
    listOrganizations?: () => Promise<readonly GraphOrganization[]>;
    loadSelfIdentity?: () => Promise<{ selfDocId: string } | null>;
}, revision: number): Promise<GraphSources> {
    const [roster, organizations, self] = await Promise.allSettled([
        Promise.resolve().then(() => listContacts(settings)).then((people) => structuredClone(people)),
        Promise.resolve().then(() => { if (!reads.listOrganizations) throw new Error("组织读取能力不可用"); return reads.listOrganizations(); }).then((organizations) => structuredClone(organizations)),
        Promise.resolve().then(() => { if (!reads.loadSelfIdentity) throw new Error("本人身份读取能力不可用"); return reads.loadSelfIdentity(); }),
    ]);
    const sources: GraphSources = {
        people: roster.status === "fulfilled" ? roster.value : [],
        organizations: organizations.status === "fulfilled" ? organizations.value : [],
        selfDocId: self.status === "fulfilled" ? self.value?.selfDocId ?? null : null,
        status: { roster: roster.status === "fulfilled" ? "verified" : "unknown",
            organizations: organizations.status === "fulfilled" ? "verified" : "unknown", self: self.status === "fulfilled" ? "verified" : "unknown" },
        errors: {}, revision,
    };
    for (const [key, result] of [["roster", roster], ["organizations", organizations], ["self", self]] as const) {
        if (result.status === "rejected") sources.errors[key] = result.reason instanceof Error ? result.reason.message : String(result.reason);
    }
    return sources;
}

export async function loadGraphReferences(sources: GraphSources, query: GraphQuery): Promise<GraphReferenceSource> {
    const center = resolveGraphCenter(sources, query);
    if (sources.status.roster !== "verified" || center.status === "unknown" || center.status === "missing") {
        return { status: "unknown", graph: { nodes: [], edges: [] }, error: "登记集合或指定中心尚未核实，未请求内核图。" };
    }
    const registry = graphRegistry(sources);
    try {
        const native = center.status === "none" ? await fetchGlobalGraph() : await fetchLocalGraph(center.id);
        const nodes = registry.graph.nodes;
        const graph = mapNativeGraph(native, { allowedDocIds: new Set(nodes.map((node) => node.id)),
            docGroups: new Map(nodes.map((node) => [node.id, node.group])), docKinds: new Map(nodes.map((node) => [node.id, node.kind ?? "person"])) });
        return { status: "verified", graph };
    } catch (error) {
        return { status: "unknown", graph: { nodes: [], edges: [] }, error: error instanceof Error ? error.message : String(error) };
    }
}
