import { getFrontend, openMobileFileById, openTab } from "siyuan";
import type { App } from "siyuan";

/** 移动端只派发打开请求；同步异常会回传，但返回不能证明宿主已完成页面切换。 */
export async function openSiYuanDocument(app: App, docId: string): Promise<void> {
    const frontend = getFrontend();
    if (frontend === "mobile" || frontend === "browser-mobile") {
        openMobileFileById(app, docId);
        return;
    }
    await openTab({ app, doc: { id: docId } });
}
