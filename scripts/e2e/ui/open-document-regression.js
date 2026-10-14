import { openSiYuanDocument } from "../../../src/libs/open-document";
import { documentNavigation } from "./siyuan-mock.js";

export async function runOpenDocumentRegression({ test, assert }) {
    const app = { name: "隔离文档入口" };
    const docId = "20261012000000-opendoc";
    const reset = () => {
        documentNavigation.frontend = null;
        documentNavigation.calls = [];
        documentNavigation.desktopHandler = () => undefined;
        documentNavigation.mobileHandler = () => undefined;
    };
    for (const frontend of ["desktop", "desktop-window", "browser-desktop", "mobile", "browser-mobile"]) {
        await test(`打开文档平台分派：${frontend} 使用官方入口且只打开一次`, async () => {
            reset();
            try {
                documentNavigation.frontend = frontend;
                await openSiYuanDocument(app, docId);
                const call = documentNavigation.calls[0];
                assert(documentNavigation.calls.length === 1, "打开文档重复触发了宿主入口");
                assert(call.platform === (frontend.endsWith("mobile") ? "mobile" : "desktop"), "移动端仍使用无操作的桌面页签入口");
                assert(call.app === app && call.docId === docId, "打开文档丢失宿主 app 或目标文档");
            } finally { reset(); }
        });
    }
    await test("打开文档平台分派：桌面异步失败保留拒绝，调用方可重试", async () => {
        reset();
        try {
            documentNavigation.frontend = "desktop";
            documentNavigation.desktopHandler = async () => { throw new Error("页签暂时不可用"); };
            let failure;
            try { await openSiYuanDocument(app, docId); }
            catch (error) { failure = error; }
            assert(failure?.message === "页签暂时不可用", "桌面打开失败被吞掉，界面无法显示错误与重试");
            documentNavigation.desktopHandler = () => undefined;
            await openSiYuanDocument(app, docId);
            assert(documentNavigation.calls.length === 2, "失败后重试未重新调用官方入口");
        } finally { reset(); }
    });
    await test("打开文档平台分派：移动同步失败转为可捕获拒绝", async () => {
        reset();
        try {
            documentNavigation.frontend = "browser-mobile";
            documentNavigation.mobileHandler = () => { throw new Error("文档无法打开"); };
            let failure;
            try { await openSiYuanDocument(app, docId); }
            catch (error) { failure = error; }
            assert(failure?.message === "文档无法打开", "移动打开失败未回传调用方");
        } finally { reset(); }
    });
}
