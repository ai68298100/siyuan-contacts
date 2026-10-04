import { captureFromDoc } from "../../../src/services/capture";

export async function runCaptureRegression({ test, assert, createFixture }) {
    await test("捕获逐人 checkpoint 保留第 2 人建档失败", async () => {
        const fixture = await createFixture({ failure: "contact-second" });
        const result = await captureFromDoc(fixture.plugin, fixture.settings, fixture.sourceDocId, fixture.options);
        const first = result.checkpoint.people.find((person) => person.name === fixture.people[0].name);
        const second = result.checkpoint.people.find((person) => person.name === fixture.people[1].name);
        assert(first?.interaction.status === "applied", "第 1 人成功事实未保留");
        assert(second?.contact.status === "failed", "第 2 人建档失败未定位到个人 checkpoint");
        assert(result.complete === false, "部分成功被错误报告为完整");
    });

    await test("捕获第 2 人互动失败后重试只补失败人", async () => {
        const fixture = await createFixture({ failure: "interaction-second" });
        const first = await captureFromDoc(fixture.plugin, fixture.settings, fixture.sourceDocId, fixture.options);
        const secondBefore = first.checkpoint.people.find((person) => person.name === fixture.people[1].name);
        assert(secondBefore?.interaction.status === "failed", "第 2 人互动失败未定位");
        fixture.clearFailure?.();
        const retry = await captureFromDoc(fixture.plugin, fixture.settings, fixture.sourceDocId, {
            ...fixture.options,
            checkpoint: first.checkpoint,
        });
        assert(retry.interactions === 1, "重试没有只补写第 2 人互动");
        assert(retry.checkpoint.people[0].interaction.status === "skipped", "第 1 人重复写入");
        assert(retry.checkpoint.people[1].interaction.status === "applied", "第 2 人未补写成功");
    });

    await test("捕获 alias 歧义和失效人物文档不按 missing 新建", async () => {
        const ambiguous = await createFixture({ failure: "alias-ambiguous" });
        const ambiguousResult = await captureFromDoc(ambiguous.plugin, ambiguous.settings, ambiguous.sourceDocId, ambiguous.options);
        assert(ambiguousResult.checkpoint.people.some((person) => person.contact.code === "alias_ambiguous"), "坏 alias 未停止对应目标");
        assert(ambiguous.writeCount?.() === 0, "alias 歧义发生后仍有写入");

        const missing = await createFixture({ failure: "missing-person" });
        const missingResult = await captureFromDoc(missing.plugin, missing.settings, missing.sourceDocId, missing.options);
        assert(missingResult.checkpoint.people.some((person) => person.contact.code === "person_missing"), "失效人物文档未报告");
        assert(missing.writeCount?.() === 0, "失效人物文档被按 missing 静默新建");
    });

    await test("互动写后回读失败报告 unknown 并保留原输入", async () => {
        const fixture = await createFixture({ failure: "interaction-readback" });
        const result = await captureFromDoc(fixture.plugin, fixture.settings, fixture.sourceDocId, fixture.options);
        const person = result.checkpoint.people[0];
        assert(person.interaction.status === "unknown", "写后回读失败未报告 unknown");
        assert(result.checkpoint.input.date === fixture.options.date, "失败后原日期输入丢失");
        assert(result.checkpoint.input.note === fixture.options.note, "失败后原备注输入丢失");
    });
}
