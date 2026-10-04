import { addRelation, removeRelation, retryRelationProjections } from "../../../src/services/relations";

function relationFixture(kernel, settings) {
    const people = ["甲", "乙", "丙"].map((name, index) => ({
        itemId: `20261004000000-item00${index + 1}`,
        docId: `20261004000000-pers00${index + 1}`,
        name, relatedItemIds: [],
    }));
    const state = {
        people, sections: new Map(), relationWrites: 0, sectionWrites: 0,
        skipRelationWrite: false, failRender: false, failAfterWrite: false,
        failSectionDoc: "", failSectionReadback: false, loseWriteResponse: false,
        duplicateSectionDoc: "",
    };
    kernel.handler = async (route, body) => {
        if (route === "/api/av/renderAttributeView") {
            if (state.failRender) throw new Error("隔离名册读取失败");
            return { view: {
                columns: [{ id: settings.fieldMap.related, name: "相关人", type: "relation" }],
                rows: people.map((person) => ({ id: person.itemId, cells: [
                    { valueType: "block", value: { keyID: "name", type: "block", block: { id: person.docId, content: person.name } } },
                    { valueType: "relation", value: { keyID: settings.fieldMap.related, type: "relation", relation: { blockIDs: [...person.relatedItemIds] } } },
                ] })),
            } };
        }
        if (route === "/api/av/setAttributeViewBlockAttr") {
            state.relationWrites += 1;
            const person = people.find((person) => person.itemId === body.itemID);
            if (!state.skipRelationWrite) person.relatedItemIds = [...body.value.relation.blockIDs];
            if (state.failAfterWrite) state.failRender = true;
            if (state.loseWriteResponse) throw new Error("隔离已应用写入但响应丢失");
            return null;
        }
        if (route === "/api/sqlite/flushTransaction") return null;
        if (route === "/api/query/sql") {
            const rootId = body.stmt.match(/root_id = '([^']+)'/)?.[1];
            if (state.failSectionReadback && state.sectionWrites > 0) throw new Error("隔离投影回读失败");
            if (body.stmt.includes("AND type = 'd'")) {
                const docId = body.stmt.match(/WHERE id = '([^']+)'/)?.[1];
                return people.some((person) => person.docId === docId) ? [{ id: docId }] : [];
            }
            if (state.duplicateSectionDoc === rootId) {
                return [{ id: "20261004000000-dup0001", markdown: "重复" }, { id: "20261004000000-dup0002", markdown: "重复" }];
            }
            return state.sections.has(rootId) ? [structuredClone(state.sections.get(rootId))] : [];
        }
        if (route === "/api/block/insertBlock") {
            if (state.failSectionDoc === body.parentID) throw new Error("隔离文档投影保存失败");
            state.sectionWrites += 1;
            const id = `20261004000000-bl${String(state.sectionWrites).padStart(5, "0")}`;
            state.sections.set(body.parentID, { id, markdown: body.data });
            return [{ doOperations: [{ id, action: "insert" }] }];
        }
        if (route === "/api/block/updateBlock") {
            const entry = [...state.sections.entries()].find(([, block]) => block.id === body.id);
            if (state.failSectionDoc === entry?.[0]) throw new Error("隔离文档投影保存失败");
            state.sectionWrites += 1;
            state.sections.set(entry[0], { id: body.id, markdown: body.data });
            return null;
        }
        if (route === "/api/block/deleteBlock") {
            const entry = [...state.sections.entries()].find(([, block]) => block.id === body.id);
            if (state.failSectionDoc === entry?.[0]) throw new Error("隔离文档投影删除失败");
            state.sectionWrites += 1;
            state.sections.delete(entry[0]);
            return null;
        }
        throw new Error(`关系夹具拒绝请求：${route}`);
    };
    return state;
}

export async function runRelationRegression({ test, assert, kernel, settings }) {
    await test("关系实际服务：并发旧快照不丢边，反向重复零写入，双方文档回读核实", async () => {
        const state = relationFixture(kernel, settings);
        const [first, second, third] = state.people;
        const stale = structuredClone(first);
        const reports = await Promise.all([addRelation(settings, stale, second), addRelation(settings, stale, third)]);
        assert(first.relatedItemIds.length === 2 && reports.every((report) => report.fact.status === "applied"), "并发关系丢失或未核实");
        assert(reports.every((report) => report.projections.every((item) => item.status === "applied")), "投影未经实际回读核实");
        assert(state.sections.get(second.docId)?.markdown.includes(first.docId), "对方文档没有反向双链");
        const before = state.relationWrites;
        const repeated = await addRelation(settings, second, stale);
        assert(state.relationWrites === before && repeated.fact.status === "unchanged", "反向重复关系仍发起属性写入");
        await removeRelation(settings, second, stale);
        assert(!first.relatedItemIds.includes(second.itemId) && first.relatedItemIds.includes(third.itemId), "从对方解除未删除真实出边或误删其他边");
        assert(!state.sections.has(second.docId), "解除后对方投影未删除");
    });

    await test("关系实际服务：code=0 未应用、写后读失败均未知；已应用响应丢失可只读核实", async () => {
        for (const failure of ["skipRelationWrite", "failAfterWrite"]) {
            const state = relationFixture(kernel, settings);
            state[failure] = true;
            let error;
            try { await addRelation(settings, state.people[0], state.people[1]); } catch (cause) { error = cause; }
            assert(error?.name === "RelationFactUnknownError" && state.relationWrites === 1, "未知写入被误报成功或自动重放");
            assert(state.sectionWrites === 0, "事实未知仍继续写文档投影");
        }
        const state = relationFixture(kernel, settings);
        state.loseWriteResponse = true;
        const report = await addRelation(settings, state.people[0], state.people[1]);
        assert(report.fact.status === "applied" && state.relationWrites === 1, "已应用写入没有通过回读核实");
    });

    await test("关系实际服务：投影部分失败保留事实，只补失败文档且按最新关系重建", async () => {
        const state = relationFixture(kernel, settings);
        const [first, second, third] = state.people;
        state.failSectionDoc = second.docId;
        const report = await addRelation(settings, first, second);
        const failed = report.projections.filter((item) => item.status !== "applied");
        assert(report.fact.status === "applied" && failed.length === 1 && failed[0].docId === second.docId && failed[0].retryKey, "事实与投影失败未隔离");
        const writes = state.relationWrites;
        state.failSectionDoc = "";
        const retried = await retryRelationProjections(settings, failed.map((item) => item.docId));
        assert(retried.every((item) => item.status === "applied") && state.relationWrites === writes, "投影重试改写关系事实");
        const sectionWrites = state.sectionWrites;
        await retryRelationProjections(settings, [second.docId]);
        assert(state.sectionWrites === sectionWrites, "相同投影重复重写");
        first.relatedItemIds = [third.itemId];
        await retryRelationProjections(settings, [first.docId, second.docId]);
        assert(!state.sections.has(second.docId) && state.sections.get(first.docId).markdown.includes(third.docId)
            && !state.sections.get(first.docId).markdown.includes(second.docId), "旧重试恢复已删除关系");
    });

    await test("关系实际服务：投影写后回读失败标未知，重复标记及已移除人物零覆盖", async () => {
        const state = relationFixture(kernel, settings);
        state.failSectionReadback = true;
        const report = await addRelation(settings, state.people[0], state.people[1]);
        assert(report.fact.status === "applied" && report.projections.some((item) => item.status === "unknown"), "投影回读失败被误报成功");
        state.failSectionReadback = false;
        state.duplicateSectionDoc = state.people[0].docId;
        const sectionWrites = state.sectionWrites;
        const duplicate = await retryRelationProjections(settings, [state.duplicateSectionDoc]);
        assert(duplicate[0].status === "unknown" && state.sectionWrites === sectionWrites, "重复标记仍自动覆盖");
        state.duplicateSectionDoc = "";
        const writes = state.relationWrites;
        const stale = structuredClone(state.people[1]);
        state.people.splice(1, 1);
        let error;
        try { await addRelation(settings, state.people[0], stale); } catch (cause) { error = cause; }
        assert(error && state.relationWrites === writes, "已移除人物仍写关系");
    });
}
