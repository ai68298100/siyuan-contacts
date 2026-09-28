/**
 * 自绘浮层定位原语（B02）：fixed 定位 + 视口内钳制。
 *
 * 为什么需要：absolute 定位的面板会被 overflow:auto 的滚动祖先（工作台 body、列表区）
 * 裁掉越界部分——真实宿主里表现为"菜单只剩右半截、像半透明"。
 * 思源自家的 .b3-menu 同样用 position:fixed（base.css 实证）。
 *
 * 用法（Svelte 5）：
 *   $effect(() => {
 *       if (!open || !wrap || !panel) return;
 *       return attachPopover(panel, wrap, () => (open = false));
 *   });
 * panel 为浮层元素，wrap 为"锚点 + 面板"的公共容器（点击其内不视为外部）。
 */

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;

export function attachPopover(panel: HTMLElement, wrap: HTMLElement, onClose: () => void): () => void {
    const place = () => {
        const anchorRect = wrap.getBoundingClientRect();
        // 先定到左上角测量自然尺寸，避免旧位置影响测量
        const previous = { left: panel.style.left, top: panel.style.top, visibility: panel.style.visibility };
        panel.style.visibility = "hidden";
        panel.style.left = "0px";
        panel.style.top = "0px";
        const rect = panel.getBoundingClientRect();
        let left = anchorRect.right - rect.width;
        left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - VIEWPORT_MARGIN - rect.width));
        let top = anchorRect.bottom + ANCHOR_GAP;
        if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
            const above = anchorRect.top - rect.height - ANCHOR_GAP;
            top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - rect.height);
        }
        panel.style.left = `${Math.round(left)}px`;
        panel.style.top = `${Math.round(top)}px`;
        panel.style.visibility = previous.visibility;
    };

    const onScroll = (event: Event) => {
        // 面板内部的滚动（长列表）不关闭
        if (event.target instanceof Node && panel.contains(event.target)) return;
        onClose();
    };
    const onResize = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") onClose();
    };
    const outside = (event: Event) => {
        const target = event.target as Node;
        if (!panel.contains(target) && !wrap.contains(target)) onClose();
    };
    const onPointerDown = (event: PointerEvent) => outside(event);
    // click 与 pointerdown 并听：键盘激活与测试合成 click 只派发 click
    const onClick = (event: MouseEvent) => outside(event);

    place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("click", onClick);
    return () => {
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("pointerdown", onPointerDown, true);
        window.removeEventListener("click", onClick);
    };
}
