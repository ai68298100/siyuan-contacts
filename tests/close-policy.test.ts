import assert from "node:assert/strict";
import test from "node:test";
import { decideClose } from "../src/domain/close-policy.ts";
import { getFocusableElements } from "../src/shared/focusable-elements.ts";

test("关闭策略：忙碌时无论是否有草稿都阻断", () => {
    assert.equal(decideClose({ busy: true, dirty: false }), "blocked");
    assert.equal(decideClose({ busy: true, dirty: true }), "blocked");
});

test("关闭策略：空闲但有草稿时进入统一确认", () => {
    assert.equal(decideClose({ busy: false, dirty: true }), "prompt");
});

test("关闭策略：空闲且无草稿时直接放行", () => {
    assert.equal(decideClose({ busy: false, dirty: false }), "allow");
});

test("D-18 焦点圈定与无障碍过滤：过滤 hidden、aria-hidden 与 inert 节点", () => {
    const makeElement = (tag: string, attrs: Record<string, string | boolean> = {}, parent?: any) => {
        const el: any = {
            tagName: tag.toUpperCase(),
            hidden: Boolean(attrs.hidden),
            parentElement: parent ?? null,
            getAttribute: (name: string) => attrs[name] !== undefined ? String(attrs[name]) : null,
            hasAttribute: (name: string) => attrs[name] !== undefined && attrs[name] !== false,
            closest: (selector: string) => (tag.toLowerCase() === selector.toLowerCase() ? el : parent?.closest?.(selector) ?? null),
        };
        return el;
    };

    const container: any = {
        querySelectorAll: (_selector: string) => {
            const normalBtn = makeElement("button", {});
            const hiddenBtn = makeElement("button", { hidden: true });
            const ariaHiddenBtn = makeElement("button", { "aria-hidden": "true" });
            const inertBtn = makeElement("button", { inert: "" });

            const parentAriaHidden = makeElement("div", { "aria-hidden": "true" });
            const childOfHidden = makeElement("button", {}, parentAriaHidden);

            const parentInert = makeElement("div", { inert: "" });
            const childOfInert = makeElement("input", {}, parentInert);

            return [normalBtn, hiddenBtn, ariaHiddenBtn, inertBtn, childOfHidden, childOfInert];
        },
    };

    const focusables = getFocusableElements(container);
    assert.equal(focusables.length, 1, "只保留正常未被隐藏/隔离的可聚焦元素");
    assert.equal(focusables[0].tagName, "BUTTON");
});
