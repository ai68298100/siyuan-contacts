import assert from "node:assert/strict";
import test from "node:test";
import { copyPlainText } from "../src/shared/clipboard.ts";

async function browserGlobals(navigatorValue: unknown, documentValue: unknown, run: () => Promise<void>) {
    const originals = ["navigator", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
    Object.defineProperty(globalThis, "document", { configurable: true, value: documentValue });
    try { await run(); }
    finally {
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
}

function selectionBrowser(accepted = true) {
    const calls: string[] = [];
    const range = {};
    const selection = {
        rangeCount: 1,
        getRangeAt: () => ({ cloneRange: () => range }),
        removeAllRanges: () => calls.push("restore-selection"),
        addRange: (restored: unknown) => { assert.equal(restored, range); calls.push("restore-range"); },
    };
    const parent = { appendChild: () => calls.push("append") };
    const activeElement = {
        parentElement: parent, selectionStart: 2, selectionEnd: 5, selectionDirection: "backward",
        focus: () => calls.push("restore-focus"),
        setSelectionRange: (...args: unknown[]) => { assert.deepEqual(args, [2, 5, "backward"]); calls.push("restore-caret"); },
    };
    const textarea = {
        value: "", readOnly: false, tabIndex: 0, style: { cssText: "" },
        setAttribute() {}, focus: () => calls.push("focus-copy"), select: () => calls.push("select"),
        setSelectionRange: (start: number, end: number) => { assert.equal(start, 0); assert.equal(end, textarea.value.length); },
        remove: () => calls.push("remove"),
    };
    const document = {
        activeElement, body: parent, getSelection: () => selection, createElement: () => textarea,
        execCommand: (command: string) => { assert.equal(command, "copy"); calls.push("copy"); return accepted; },
    };
    return { document, calls, textarea };
}

test("剪贴板保留完整多行、首尾空白和特殊字符，优先标准 API", async () => {
    const value = '  +00 123\n第二行\t<&>😀  ';
    const copied: string[] = [];
    await browserGlobals({ clipboard: { writeText: async (text: string) => { copied.push(text); } } }, undefined, async () => {
        await copyPlainText(value);
        assert.deepEqual(copied, [value]);
    });
});

test("标准 API 拒绝后不启动迟到的选择复制或改变焦点", async () => {
    const fallback = selectionBrowser();
    const rejected = new Error("clipboard denied");
    await browserGlobals({ clipboard: { writeText: async () => { throw rejected; } } }, fallback.document, async () => {
        await assert.rejects(copyPlainText("原值"), (error) => error === rejected);
        assert.deepEqual(fallback.calls, []);
    });
});

test("HTTP 缺少 Clipboard API 时同步复制，并清理临时控件、恢复焦点和选区", async () => {
    const fallback = selectionBrowser();
    const value = ' 多行\n值 &amp; "引号" ';
    await browserGlobals({}, fallback.document, async () => {
        await copyPlainText(value);
        assert.equal(fallback.textarea.value, value);
        assert.equal(fallback.textarea.readOnly, true);
        assert.deepEqual(fallback.calls, ["append", "focus-copy", "select", "copy", "remove", "restore-focus", "restore-selection", "restore-range", "restore-caret"]);
    });
});

test("选择复制被拒绝也清理临时控件和恢复焦点，不报告成功", async () => {
    const fallback = selectionBrowser(false);
    await browserGlobals({}, fallback.document, async () => {
        await assert.rejects(copyPlainText("保留值"), /手动选择内容复制/);
        assert.deepEqual(fallback.calls.slice(-5), ["remove", "restore-focus", "restore-selection", "restore-range", "restore-caret"]);
    });
});

test("无剪贴板能力时明确失败，非文本输入不触发任何复制", async () => {
    await browserGlobals({}, {}, async () => {
        await assert.rejects(copyPlainText("保留值"), /手动选择内容复制/);
        await assert.rejects(copyPlainText(null as unknown as string), /必须是文本/);
    });
});

test("复制排他跨独立调用生效，挂起时立即拒绝且不排队，成功结束后可重试", async () => {
    const copied: string[] = [];
    let finish!: () => void;
    await browserGlobals({ clipboard: { writeText: (text: string) => {
        copied.push(text);
        return text === "人物 A" ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve();
    } } }, undefined, async () => {
        const original = copyPlainText("人物 A");
        await assert.rejects(copyPlainText("人物 B"), /前一次复制尚未完成/);
        assert.deepEqual(copied, ["人物 A"], "独立调用不能发出第二个实际复制请求");
        finish();
        await original;
        await Promise.resolve();
        assert.deepEqual(copied, ["人物 A"], "被拒绝请求不能排队到原请求结束后自动执行");
        await copyPlainText("人物 B");
        assert.deepEqual(copied, ["人物 A", "人物 B"], "原请求结束后应允许新的明确操作");
    });
});

test("原复制拒绝后释放共享排他锁，等待期间不降级启动选择复制", async () => {
    const copied: string[] = [];
    const fallback = selectionBrowser();
    const failure = new Error("原请求被拒绝");
    let reject!: (reason: Error) => void;
    await browserGlobals({ clipboard: { writeText: (text: string) => {
        copied.push(text);
        return text === "原请求" ? new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }) : Promise.resolve();
    } } }, fallback.document, async () => {
        const original = copyPlainText("原请求");
        await assert.rejects(copyPlainText("不应执行"), /前一次复制尚未完成/);
        assert.deepEqual(fallback.calls, [], "锁阻止的复制不能改走选择复制");
        const rejected = assert.rejects(original, (error) => error === failure);
        reject(failure);
        await rejected;
        await copyPlainText("明确重试");
        assert.deepEqual(copied, ["原请求", "明确重试"]);
        assert.deepEqual(fallback.calls, [], "异步拒绝后不允许启动迟到的选择复制");
    });
});
