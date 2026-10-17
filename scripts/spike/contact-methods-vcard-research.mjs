/**
 * AG-RF-004-S1: synthetic candidate only; no plugin/schema/API changes.
 * Ordinary UTF-8 TEL/EMAIL/URL values are mapped. Opaque source properties
 * remain in this in-memory preview and require opt-in for re-export.
 * This is semantic (logical-line) research, not a production vCard codec.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { unfoldVcfLines, unescapeVcf, escapeVcf, parseVcfForImport } from '../../src/domain/vcard.ts';

const methodTypes = new Map([['TEL', 'phone'], ['EMAIL', 'email'], ['URL', 'url']]);
const structural = new Set(['VERSION', 'FN', 'N']);
const knownParameters = new Set(['TYPE', 'PREF', 'VALUE']);
const labelSupported = (prop) => prop.parameters.length === 0;
function splitQuoted(value, delimiter) {
    const result = [];
    let start = 0, quoted = false;
    for (let i = 0; i < value.length; i++) {
        if (value[i] === '"') quoted = !quoted;
        if (value[i] === delimiter && !quoted) { result.push(value.slice(start, i)); start = i + 1; }
    }
    if (quoted) throw new Error('invalid_parameter_quotes');
    result.push(value.slice(start));
    return result;
}
function property(line) {
    let quoted = false, colon = -1;
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        if (line[i] === ':' && !quoted) { colon = i; break; }
    }
    if (colon <= 0) throw new Error('invalid_property');
    const header = line.slice(0, colon);
    const [token, ...segments] = splitQuoted(header, ';');
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)?$/i.test(token)) throw new Error('invalid_property_name');
    const dot = token.indexOf('.');
    const group = dot < 0 ? '' : token.slice(0, dot);
    const name = (dot < 0 ? token : token.slice(dot + 1)).toUpperCase();
    const parameters = segments.map((raw) => {
        const equal = raw.indexOf('=');
        // Bare 2.1 TYPE parameters are outside this candidate's mapping scope.
        if (equal < 1) return { name: '', value: raw, raw, unmapped: true };
        const name = raw.slice(0, equal).toUpperCase();
        const value = raw.slice(equal + 1).replace(/^"|"$/g, '');
        return { name, value, raw };
    });
    return { line, header, name, group, parameters, rawValue: line.slice(colon + 1) };
}
function preview(text, requestId, { expectedDigest } = {}) {
    if (!requestId) throw new Error('missing_source_request');
    const sourceDigest = createHash('sha256').update(text).digest('hex');
    if (expectedDigest !== undefined && expectedDigest !== sourceDigest) throw new Error('source_request_conflict');
    const cards = [];
    let current = null;
    for (const line of unfoldVcfLines(text)) {
        const marker = line.trim().toUpperCase();
        if (marker === 'BEGIN:VCARD') {
            if (current) throw new Error('nested_card');
            current = [];
        } else if (marker === 'END:VCARD') {
            if (!current) throw new Error('unexpected_card_end');
            cards.push({ properties: current }); current = null;
        } else if (line.trim()) {
            if (!current) throw new Error('outside_card');
            current.push(property(line));
        }
    }
    if (current) throw new Error('truncated_card');
    if (!cards.length) throw new Error('empty_document');
    const reports = [];
    for (const [cardIndex, card] of cards.entries()) {
        card.sourceId = `${requestId}/card/${cardIndex + 1}`;
        card.methods = [];
        const report = (propertyIndex, category) => reports.push({ card: cardIndex + 1, property: propertyIndex + 1, category });
        for (const [propertyIndex, prop] of card.properties.entries()) {
            const type = methodTypes.get(prop.name);
            if (!type) {
                if (!structural.has(prop.name) && prop.name !== 'X-ABLABEL') report(propertyIndex, 'retained_unmapped_property');
                continue;
            }
            if (!prop.rawValue.trim()) { report(propertyIndex, 'retained_unmapped_empty_value'); continue; }
            if (prop.parameters.some((p) => p.name === 'ENCODING' || p.name === 'CHARSET')) {
                report(propertyIndex, 'retained_unmapped_encoding'); continue;
            }
            if (prop.parameters.some((p) => p.unmapped || p.raw.includes('^'))) {
                report(propertyIndex, 'retained_unmapped_parameter_codec'); continue;
            }
            const valueParameters = prop.parameters.filter((p) => p.name === 'VALUE');
            const valueKind = valueParameters[0]?.value.toLowerCase() ?? (type === 'url' ? 'uri' : 'text');
            if (valueParameters.length > 1 || !['text', 'uri'].includes(valueKind) || (type === 'email' && valueKind !== 'text') || (type === 'url' && valueKind !== 'uri')) {
                report(propertyIndex, 'retained_unmapped_value_type'); continue;
            }
            if (valueKind === 'uri' && /[\r\n\x00-\x20\\]/.test(prop.rawValue)) {
                report(propertyIndex, 'retained_unmapped_uri'); continue;
            }
            if (prop.parameters.some((p) => !knownParameters.has(p.name))) report(propertyIndex, 'retained_unknown_parameter');
            const labels = prop.group ? card.properties.filter((p) => p.group.toLowerCase() === prop.group.toLowerCase() && p.name === 'X-ABLABEL' && labelSupported(p)) : [];
            const preference = prop.parameters.filter((p) => p.name === 'PREF').map((p) => p.value);
            if (preference.length > 1 || preference.some((p) => !/^(?:[1-9]|[1-9][0-9]|100)$/.test(p))) report(propertyIndex, 'preference_needs_review');
            const method = {
                id: `${card.sourceId}/property/${propertyIndex + 1}`, type, propertyIndex,
                value: valueKind === 'uri' ? prop.rawValue : unescapeVcf(prop.rawValue), valueKind, group: prop.group,
                typeTokens: prop.parameters.filter((p) => p.name === 'TYPE').flatMap((p) => p.value.split(',')),
                preference, labels: labels.map((p) => unescapeVcf(p.rawValue)),
                parameters: prop.parameters.map((p) => ({ ...p })),
            };
            card.methods.push(method);
        }
        for (const [index, prop] of card.properties.entries()) {
            if (prop.name !== 'X-ABLABEL') continue;
            if (!labelSupported(prop)) report(index, 'retained_unmapped_label_parameters');
            else if (!prop.group || !card.methods.some((method) => method.group.toLowerCase() === prop.group.toLowerCase())) report(index, 'retained_unmapped_orphan_label');
        }
    }
    return { researchFormat: 1, requestId, sourceDigest, cards, reports };
}
function exportPreview(document, { includeUnmapped = false } = {}) {
    const lines = [], reports = [];
    for (const [cardIndex, card] of document.cards.entries()) {
        lines.push('BEGIN:VCARD');
        const methods = new Map(card.methods.map((method) => [method.propertyIndex, method]));
        const groups = new Set(card.methods.map((method) => method.group.toLowerCase()).filter(Boolean));
        for (const [index, prop] of card.properties.entries()) {
            const method = methods.get(index);
            if (method) {
                const segments = splitQuoted(prop.header, ';');
                const kept = prop.parameters.filter((parameter) => includeUnmapped || knownParameters.has(parameter.name));
                if (kept.length !== prop.parameters.length) reports.push({ card: cardIndex + 1, property: index + 1, category: 'excluded_unknown_parameter_by_default' });
                const header = [segments[0], ...kept.map((parameter) => parameter.raw)].join(';');
                if (method.valueKind === 'uri' && /[\r\n\x00-\x20\\]/.test(method.value)) throw new Error('invalid_uri_edit');
                // URI values must not pass through vCard TEXT escaping.
                const value = method.valueKind === 'uri' ? method.value : escapeVcf(method.value);
                lines.push(`${header}:${value}`);
            } else if (structural.has(prop.name) || (prop.name === 'X-ABLABEL' && groups.has(prop.group.toLowerCase()) && labelSupported(prop)) || includeUnmapped) {
                lines.push(prop.line);
            } else reports.push({ card: cardIndex + 1, property: index + 1, category: 'excluded_by_default' });
        }
        lines.push('END:VCARD');
    }
    return { text: lines.join('\r\n') + '\r\n', reports };
}
const semantic = (document) => document.cards.map((card) => card.methods.map(({ id, propertyIndex, parameters, ...method }) => ({ ...method, parameters: parameters.filter((p) => knownParameters.has(p.name)) })));
const card = (...lines) => ['BEGIN:VCARD', ...lines, 'END:VCARD'].join('\r\n');
const multi = card('VERSION:3.0', 'FN:虚构多值',
    'item1.TEL;TYPE=WORK,CELL;TYPE=VOICE;X-PRIVATE="a;b:c":+00 111',
    'item1.X-ABLabel:工作\\,主线', 'TEL;TYPE=HOME:+00 222',
    'EMAIL;TYPE=WORK:work@example.test', 'EMAIL;TYPE=HOME:private@example.test',
    'URL:https://example.test/primary', 'URL:https://example.test/secondary');
const fixtures = [
    { id: 'v3-multi-parameters-group-label', text: multi, count: 6 },
    { id: 'v4-pref-uri', text: card('VERSION:4.0', 'FN:虚构四版', 'TEL;VALUE=uri;PREF=1:tel:+00-111;ext=123', 'TEL;PREF=2:+00 222', 'EMAIL;TYPE="work,voice";PREF=1:work@example.test', 'URL:https://example.test/a;b?q=x,y'), count: 4 },
    { id: 'duplicate-values-remain-separate', text: card('VERSION:3.0', 'FN:虚构重复', 'TEL:+00 111', 'TEL:+00 111'), count: 2 },
    { id: 'equal-values-across-cards', text: card('FN:同名', 'TEL:+00 111') + '\r\n' + card('FN:同名', 'TEL:+00 111'), count: 2 },
    { id: 'escaped-unicode-folds', text: card('VERSION:3.0', 'FN:虚构转义', 'item1.TEL:+00\\,111\\;ext\\\\尾', 'item1.X-ABLabel:很长的标\r\n 签', 'URL:https://example.test/a,b'), count: 2 },
    { id: 'unknown-properties-private-by-default', text: card('VERSION:3.0', 'FN:虚构未知', 'TEL:+00 111', 'NOTE:PRIVATE-SENTINEL', 'X-WECHAT:WECHAT-SENTINEL', 'X-QQ:QQ-SENTINEL'), count: 1 },
    { id: 'qp-retained-unmapped', text: card('VERSION:2.1', 'FN:虚构编码', 'TEL;ENCODING=QP:=2B00=20=31=31=31', 'EMAIL:sample@example.test'), count: 1 },
    { id: 'empty-value-retained-unmapped', text: card('FN:虚构空项', 'TEL:', 'EMAIL:sample@example.test'), count: 1 },
    { id: 'parameter-codec-retained-unmapped', text: card('FN:虚构参数', 'TEL;TYPE=work;X-LABEL=a^nb:+00 111', 'EMAIL:sample@example.test'), count: 1 },
    { id: 'invalid-pref-visible', text: card('VERSION:4.0', 'FN:虚构优先级', 'TEL;PREF=0:+00 111'), count: 1 },
    { id: 'legacy-single-value', text: card('VERSION:3.0', 'FN:虚构旧值', 'TEL:+00 111 / +00 222', 'EMAIL:sample@example.test'), count: 2 },
    { id: 'unknown-value-type', text: card('FN:虚构值类型', 'TEL;VALUE=binary:YWJj', 'EMAIL:sample@example.test'), count: 1 },
    { id: 'encoded-and-orphan-labels', text: card('FN:虚构标签', 'item1.TEL:+00 111', 'item1.X-ABLabel;ENCODING=QP:=57=4F=52=4B', 'item2.X-ABLabel:孤立标签'), count: 1 },
];
const checks = [];
function check(id, run) {
    try { run(); checks.push({ id, pass: true }); }
    catch { checks.push({ id, pass: false }); }
}
const started = performance.now();
const cases = fixtures.map((fixture) => {
    const candidate = preview(fixture.text, `request-${fixture.id}`);
    const outgoing = exportPreview(candidate);
    const retained = exportPreview(candidate, { includeUnmapped: true });
    const roundtrip = preview(outgoing.text, `roundtrip-${fixture.id}`);
    check(`${fixture.id}:mapped-count`, () => assert.equal(candidate.cards.reduce((sum, c) => sum + c.methods.length, 0), fixture.count));
    check(`${fixture.id}:semantic-roundtrip`, () => assert.deepEqual(semantic(roundtrip), semantic(candidate)));
    check(`${fixture.id}:explicit-retention`, () => assert.deepEqual(unfoldVcfLines(retained.text).filter(Boolean), unfoldVcfLines(fixture.text).filter(Boolean)));
    return { id: fixture.id, methodCounts: candidate.cards.map((c) => c.methods.length), candidateMethods: candidate.cards.map((c) => c.methods),
        importReports: candidate.reports, defaultExportReports: outgoing.reports };
});
check('quoted-parameter-and-type-label-separation', () => {
    const method = preview(multi, 'same-request').cards[0].methods[0];
    assert.deepEqual(method.typeTokens, ['WORK', 'CELL', 'VOICE']);
    assert.deepEqual(method.labels, ['工作,主线']);
    assert.equal(method.parameters.at(-1).value, 'a;b:c');
});
check('identity-not-value-or-person-name', () => {
    const document = preview(fixtures[3].text, 'fixed-request');
    assert.notEqual(document.cards[0].methods[0].id, document.cards[1].methods[0].id);
    const method = document.cards[0].methods[0], originalId = method.id;
    method.value = '+00 999'; method.labels = ['已修改'];
    assert.equal(method.id, originalId);
    assert.equal(preview(exportPreview(document).text, 'edited').cards[0].methods[0].value, '+00 999');
    assert.notEqual(preview(fixtures[3].text, 'new-confirmed-request').cards[0].methods[0].id, originalId);
});
check('no-implicit-private-extension-export', () => {
    const result = exportPreview(preview(fixtures[5].text, 'privacy'));
    assert.doesNotMatch(result.text, /PRIVATE-SENTINEL|WECHAT-SENTINEL|QQ-SENTINEL/);
    assert.equal(result.reports.length, 3);
});
check('uri-output-matches-independent-literal-expectation', () => {
    const result = exportPreview(preview(fixtures[1].text, 'uri'));
    assert.ok(result.text.includes('TEL;VALUE=uri;PREF=1:tel:+00-111;ext=123\r\n'));
    assert.ok(result.text.includes('URL:https://example.test/a;b?q=x,y\r\n'));
    assert.doesNotMatch(result.text, /\\[;,]/);
});
check('unknown-parameter-also-requires-opt-in', () => {
    const source = card('FN:虚构隐私', 'TEL;X-PRIVATE=PRIVATE-SENTINEL:+00 111');
    const candidate = preview(source, 'private-parameter');
    const result = exportPreview(candidate);
    assert.doesNotMatch(result.text, /PRIVATE-SENTINEL/);
    assert.deepEqual(result.reports, [{ card: 1, property: 2, category: 'excluded_unknown_parameter_by_default' }]);
    assert.ok(exportPreview(candidate, { includeUnmapped: true }).text.includes('X-PRIVATE=PRIVATE-SENTINEL'));
});
check('encoded-label-is-not-text-and-orphan-label-is-reported', () => {
    const candidate = preview(fixtures[12].text, 'labels');
    assert.deepEqual(candidate.cards[0].methods[0].labels, []);
    assert.deepEqual(candidate.reports.map((r) => r.category), ['retained_unmapped_label_parameters', 'retained_unmapped_orphan_label']);
    assert.doesNotMatch(exportPreview(candidate).text, /X-ABLabel/i);
});
check('legacy-phone-separator-not-split', () => assert.equal(preview(fixtures[10].text, 'legacy').cards[0].methods[0].value, '+00 111 / +00 222'));
check('retry-uses-frozen-source-and-original-identities', () => {
    const original = preview(multi, 'frozen-request');
    assert.deepEqual(preview(multi, original.requestId, { expectedDigest: original.sourceDigest }), original);
    assert.throws(() => preview(multi.replace('+00 111', '+00 999'), original.requestId, { expectedDigest: original.sourceDigest }), /source_request_conflict/);
});
for (const [fixtureIndex, expected] of [[0, 'retained_unknown_parameter'], [5, 'retained_unmapped_property'], [6, 'retained_unmapped_encoding'], [7, 'retained_unmapped_empty_value'], [8, 'retained_unmapped_parameter_codec'], [9, 'preference_needs_review'], [11, 'retained_unmapped_value_type']]) {
    check(`exact-report:${fixtures[fixtureIndex].id}`, () => assert.deepEqual([...new Set(cases[fixtureIndex].importReports.map((report) => report.category))], [expected]));
}
check('production-compatibility-unchanged', () => {
    const [actual] = parseVcfForImport(multi);
    assert.equal(actual.phone, '+00 111 / +00 222');
    assert.equal(actual.email, 'work@example.test');
    assert.equal(actual.website, 'https://example.test/primary');
});
for (const [id, text] of [['nested', 'BEGIN:VCARD\r\nBEGIN:VCARD\r\nEND:VCARD'], ['truncated', 'BEGIN:VCARD\r\nFN:虚构'], ['bad-property', card('FN:虚构', 'invalid')], ['bad-quotes', card('FN:虚构', 'TEL;TYPE="work:+00 111')]]) {
    check(`reject:${id}`, () => assert.throws(() => preview(text, 'invalid')));
}
check('diagnostics-do-not-contain-values-labels-or-source-lines', () => {
    for (const entry of cases) {
        for (const report of [...entry.importReports, ...entry.defaultExportReports]) assert.deepEqual(Object.keys(report).sort(), ['card', 'category', 'property']);
    }
});
const result = { generatedAt: new Date().toISOString(), syntheticOnly: true, kernelRequests: 0, pluginWrites: 0, productionChanges: false,
    candidateContractAccepted: false, evidence: 'synthetic-candidate-adapter', identityScope: 'frozen-confirmed-source-request-only; not stable across independent files/reordering',
    supported: ['ordinary UTF-8 TEL/EMAIL/URL', 'TYPE/PREF raw parameters', 'grouped X-ABLabel', 'logical-line semantic roundtrip'],
    limitations: ['No production codec/storage/migration/UI integration', 'No external address-book interoperability', 'Unknown encodings/parameter codecs remain opaque', 'No byte-identical folding or property editing beyond mapped values', 'No new method creation/deletion or group-label editing', 'Unmapped re-export requires explicit opt-in'],
    summary: { total: checks.length, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).length, inputBytes: fixtures.reduce((sum, f) => sum + Buffer.byteLength(f.text), 0), elapsedMs: Number((performance.now() - started).toFixed(2)) }, checks, cases };
writeFileSync(new URL('./contact-methods-vcard-research-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(result.summary, null, 2));
if (result.summary.failed) { console.error(checks.filter((c) => !c.pass).map((c) => c.id)); process.exitCode = 1; }
