/**
 * 小驴人脉 · 无障碍与高对比度样式契约自动化测试
 * 确保 forced-colors 系统颜色映射、prefers-contrast 增强边框以及关键视觉标记不退化。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");

test("小驴人脉 · 设计令牌声明完整的 forced-colors 系统变量映射", () => {
    const tokensContent = fs.readFileSync(path.join(SRC, "style", "_tokens.scss"), "utf8");
    assert.match(tokensContent, /@media \(forced-colors: active\)/);
    assert.match(tokensContent, /--lvct-accent:\s*Highlight/);
    assert.match(tokensContent, /--lvct-on-accent:\s*HighlightText/);
    assert.match(tokensContent, /--lvct-bg-app:\s*Canvas/);
    assert.match(tokensContent, /--lvct-bg-surface:\s*Canvas/);
    assert.match(tokensContent, /--lvct-text-1:\s*CanvasText/);
    assert.match(tokensContent, /--lvct-border-subtle:\s*CanvasText/);
    assert.match(tokensContent, /--lvct-focus-ring-color:\s*Highlight/);

    // Host bridge variables
    assert.match(tokensContent, /--b3-theme-primary:\s*Highlight;/);
    assert.match(tokensContent, /--b3-theme-on-primary:\s*HighlightText;/);
    assert.match(tokensContent, /--b3-theme-background:\s*Canvas;/);
    assert.match(tokensContent, /--b3-theme-surface:\s*Canvas;/);
    assert.match(tokensContent, /--b3-theme-on-background:\s*CanvasText;/);
    assert.match(tokensContent, /--b3-border-color:\s*CanvasText;/);
});

test("小驴人脉 · 公共控件层在 forced-colors 下强制卡片、弹窗与按钮实体边框", () => {
    const controlsContent = fs.readFileSync(path.join(SRC, "style", "_controls.scss"), "utf8");
    assert.match(controlsContent, /@media \(forced-colors: active\)/);
    assert.match(controlsContent, /\.lvct-sheet,\s*[\s\S]*\.lvct-person-card,\s*[\s\S]*border:\s*1px solid CanvasText/);
    assert.match(controlsContent, /\.lvct-dialog-panel,\s*[\s\S]*border:\s*2px solid CanvasText/);
    assert.match(controlsContent, /outline-color:\s*Highlight/);
});

test("小驴人脉 · 独立弹窗隔离层 (body-level .b3-dialog) 在 forced-colors 下确保高对比度容器与交互元素", () => {
    const controlsContent = fs.readFileSync(path.join(SRC, "style", "_controls.scss"), "utf8");
    assert.match(controlsContent, /\.b3-dialog:has\(\.b3-dialog__content\)/);
    assert.match(controlsContent, /\.b3-dialog__container\s*\{[^}]*border:\s*2px solid CanvasText !important;/);
    assert.match(controlsContent, /\.b3-dialog__header\s*\{[^}]*border-bottom:\s*1px solid CanvasText !important;/);
    assert.match(controlsContent, /\.b3-dialog__action\s*\{[^}]*border-top:\s*1px solid CanvasText !important;/);
    assert.match(controlsContent, /\.b3-button--primary,\s*#confirmDialogConfirmBtn\s*\{[^}]*background:\s*Highlight !important;/);
    assert.match(controlsContent, /:where\(button, a, input, select, textarea, \[tabindex="0"\]\):focus-visible,\s*:focus-visible\s*\{[^}]*outline:\s*2px solid Highlight !important;/);
});

test("小驴人脉 · 关键视觉标记与状态点在强制色模式下禁止系统擦除 (forced-color-adjust: none)", () => {
    const controlsContent = fs.readFileSync(path.join(SRC, "style", "_controls.scss"), "utf8");
    assert.match(controlsContent, /\.lvct-avatar,\s*[\s\S]*\.lvct-status-dot,\s*[\s\S]*forced-color-adjust:\s*none/);
});

test("小驴人脉 · 用户高对比度偏好 (prefers-contrast: more) 提供强化边框与焦点环", () => {
    const controlsContent = fs.readFileSync(path.join(SRC, "style", "_controls.scss"), "utf8");
    assert.match(controlsContent, /@media \(prefers-contrast: more\)/);
    assert.match(controlsContent, /--lvct-border-subtle:\s*color-mix\(in srgb,\s*var\(--lvct-text-1\)\s*45%,\s*transparent\)/);
    assert.match(controlsContent, /:where\(button, a, input, select, textarea, \[tabindex="0"\]\):focus-visible\s*\{[^}]*outline:\s*3px solid var\(--lvct-accent\)/);
    assert.match(controlsContent, /\.b3-dialog__container\s*\{[^}]*border:\s*2px solid var\(--b3-theme-on-background,\s*currentColor\) !important;/);
});
