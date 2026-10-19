/**
 * Return controls that can actually receive focus inside a modal or sheet.
 *
 * A selector alone also returns controls in a closed <details>, an aria-hidden
 * subtree or an inert subtree. Those stale nodes can break a focus loop when a
 * dialog changes sections while it is open, so filter the structural states
 * here and share the rule across Svelte and DOM-created dialogs.
 */
const FOCUSABLE_SELECTOR = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function getFocusableElements(container: ParentNode): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(isFocusableElement);
}

function isFocusableElement(element: HTMLElement): boolean {
    if (element.hidden || element.getAttribute("aria-hidden") === "true" || element.hasAttribute("inert")) return false;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.hidden || ancestor.getAttribute("aria-hidden") === "true" || ancestor.hasAttribute("inert")) return false;
        if (typeof HTMLDetailsElement !== "undefined" && ancestor instanceof HTMLDetailsElement
            && !ancestor.open && !element.closest("summary")) return false;
        if (typeof HTMLFieldSetElement !== "undefined" && ancestor instanceof HTMLFieldSetElement
            && ancestor.disabled && !element.closest("legend")) return false;
    }
    return true;
}
