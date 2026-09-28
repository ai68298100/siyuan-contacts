/**
 * FUNC-01.7：数据变化通知的窗口内事件通道。
 *
 * 宿主在数据库/存储变化时对每个窗口的插件实例回调 `onDataChanged`（跨窗口投递由宿主完成，
 * 真实多窗口行为 Host pending）；插件入口把回调防抖后经本通道广播，工作台组件订阅后
 * 原地刷新（revision bump），不刷新浏览器全局、不依赖插件重载。
 * 放在 libs 以便 index.ts 与组件共同引用而不产生循环依赖。
 */

export const LVCT_DATA_CHANGED = "lvct-data-changed";

/** 插件入口调用：广播一次数据变化（调用方负责防抖合并连续事件） */
export function emitDataChanged(): void {
    window.dispatchEvent(new CustomEvent(LVCT_DATA_CHANGED));
}

/** 组件调用：订阅数据变化，返回取消订阅函数 */
export function subscribeDataChanged(handler: () => void): () => void {
    const wrapped = () => handler();
    window.addEventListener(LVCT_DATA_CHANGED, wrapped);
    return () => window.removeEventListener(LVCT_DATA_CHANGED, wrapped);
}
