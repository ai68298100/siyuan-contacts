/** AG-RF-004-S2: bounded synthetic research, never a production store or kernel adapter. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadJsonStrict, saveJsonVerified, withStoreLock } from '../../src/data/storage.ts';
import { withTimeout } from '../../src/shared/async.ts';

export const FORMAT = 'contact-methods-recovery-research/1';
export const BACKUP_FORMAT = 'contact-methods-recovery-backup-research/1';
export const STORE_KEY = 'synthetic-contact-methods-recovery.json';
const TYPES = ['phone', 'email', 'wechat', 'url'];
const STATES = ['prepared', 'issued', 'unknown', 'verified', 'rejected'];
const TARGET_KEYS = ['workspace', 'notebook', 'dbBlock', 'av', 'item', 'doc', 'column', 'type'];
const clone = (value) => structuredClone(value);
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function fail(category) { throw new Error(category); }
function object(value, keys) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== keys.length || !same(Object.keys(value).sort(), [...keys].sort())) fail('invalid_shape');
    if (Object.values(Object.getOwnPropertyDescriptors(value)).some((descriptor) => !descriptor.enumerable || !('value' in descriptor))) fail('invalid_json_object');
}
function integer(value) { if (!Number.isSafeInteger(value) || value < 0) fail('invalid_integer'); }
function text(value, max, allowEmpty = false) {
    if (typeof value !== 'string' || value.length > max || /\p{Cc}/u.test(value) || (!allowEmpty && !value.trim())) fail('invalid_text');
}
function identity(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) fail('invalid_identity'); }
function docId(value) { if (typeof value !== 'string' || !/^\d{14}-[a-z0-9]{7}$/u.test(value)) fail('invalid_document_identity'); }
function kind(value) { if (!TYPES.includes(value)) fail('invalid_method_type'); }
function array(value) { if (!Array.isArray(value)) fail('invalid_array'); }
function unique(values) { if (new Set(values).size !== values.length) fail('duplicate_identity'); }
function frozen(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
    return value;
}
function validatePerson(person, revision) {
    object(person, ['docId', 'methods', 'tombstones']); docId(person.docId);
    array(person.methods); array(person.tombstones);
    if (person.methods.length > 128) fail('too_many_methods');
    for (const method of person.methods) {
        object(method, ['id', 'type', 'value', 'label', 'order', 'primary']);
        identity(method.id); kind(method.type); text(method.value, 4096); text(method.label, 128, true); integer(method.order);
        if (typeof method.primary !== 'boolean') fail('invalid_primary');
    }
    unique(person.methods.map((method) => method.id));
    for (const tombstone of person.tombstones) {
        object(tombstone, ['id', 'type', 'deletedRevision']); identity(tombstone.id); kind(tombstone.type); integer(tombstone.deletedRevision);
        if (tombstone.deletedRevision > revision) fail('future_tombstone');
    }
    unique(person.tombstones.map((entry) => entry.id));
    if (person.methods.some((method) => person.tombstones.some((entry) => entry.id === method.id))) fail('resurrected_identity');
    for (const type of TYPES) if (person.methods.filter((method) => method.type === type && method.primary).length > 1) fail('multiple_primary');
}
function canonicalPerson(person) {
    const result = clone(person);
    result.methods.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'));
    result.tombstones.sort((a, b) => a.id.localeCompare(b.id, 'en'));
    return result;
}
function validatePeople(people, revision) {
    array(people); unique(people.map((person) => person?.docId));
    for (const person of people) validatePerson(person, revision);
}
function validateTarget(target) {
    object(target, TARGET_KEYS);
    for (const key of TARGET_KEYS.filter((entry) => !['doc', 'type'].includes(entry))) identity(target[key]);
    docId(target.doc); kind(target.type);
}
export function primaryValue(person, type) { return person.methods.find((method) => method.type === type && method.primary)?.value ?? ''; }
export function requestDigest(request) {
    return hash({ target: request.target, baseline: request.baseline, desired: request.desired, factsRevision: request.factsRevision, confirmed: canonicalPerson(request.confirmed) });
}
function validateRequest(request, revision, people) {
    object(request, ['id', 'digest', 'state', 'target', 'baseline', 'desired', 'factsRevision', 'confirmed']);
    identity(request.id); validateTarget(request.target); text(request.baseline, 4096, true); text(request.desired, 4096, true);
    integer(request.factsRevision); if (request.factsRevision > revision) fail('future_request');
    if (!STATES.includes(request.state)) fail('invalid_request_state');
    validatePerson(request.confirmed, request.factsRevision);
    if (request.confirmed.docId !== request.target.doc || !people.some((person) => person.docId === request.target.doc)) fail('request_document_mismatch');
    if (primaryValue(request.confirmed, request.target.type) !== request.desired) fail('desired_not_confirmed_primary');
    if (request.digest !== requestDigest(request)) fail('request_digest_mismatch');
    if (request.state !== 'verified') {
        const current = people.find((person) => person.docId === request.target.doc);
        const subset = (person) => ({
            methods: canonicalPerson(person).methods.filter((entry) => entry.type === request.target.type),
            tombstones: canonicalPerson(person).tombstones.filter((entry) => entry.type === request.target.type),
        });
        if (!same(subset(current), subset(request.confirmed))) fail('pending_facts_changed');
    }
}
/** Independent clone; rejects instead of truncating, repairing, or dropping fields. */
export function strictEnvelope(input) {
    object(input, ['researchFormat', 'revision', 'people', 'requests']);
    if (input.researchFormat !== FORMAT) fail('unsupported_format');
    integer(input.revision); validatePeople(input.people, input.revision); array(input.requests);
    unique(input.requests.map((request) => request?.id));
    for (const request of input.requests) validateRequest(request, input.revision, input.people);
    unique(input.requests.filter((request) => request.state !== 'verified').map((request) => `${request.target.doc}/${request.target.type}`));
    const output = clone(input); output.people = output.people.map(canonicalPerson).sort((a, b) => a.docId.localeCompare(b.docId));
    return frozen(output);
}
export function strictBackup(input) {
    object(input, ['researchFormat', 'revision', 'people']);
    if (input.researchFormat !== BACKUP_FORMAT) fail('unsupported_backup_format');
    integer(input.revision); validatePeople(input.people, input.revision);
    return frozen({ researchFormat: BACKUP_FORMAT, revision: input.revision, people: input.people.map(canonicalPerson) });
}
/** A preview only. Imported tombstone generations belong to this new local generation. */
export function previewBackup(currentInput, backupInput, reachableDocIds) {
    const current = strictEnvelope(currentInput), backup = strictBackup(backupInput);
    if (!(reachableDocIds instanceof Set)) fail('reachability_required');
    if (!Number.isSafeInteger(current.revision + 1)) fail('revision_overflow');
    const next = clone(current); next.revision += 1;
    const reports = [];
    for (const incoming of backup.people) {
        if (!reachableDocIds.has(incoming.docId)) { reports.push('unresolved_document'); continue; }
        let person = next.people.find((entry) => entry.docId === incoming.docId);
        if (!person) { person = { docId: incoming.docId, methods: [], tombstones: [] }; next.people.push(person); }
        const original = clone(person);
        for (const tombstone of incoming.tombstones) {
            if (person.methods.some((entry) => entry.id === tombstone.id)) { reports.push('incoming_tombstone_conflict'); continue; }
            const old = person.tombstones.find((entry) => entry.id === tombstone.id);
            if (old) { if (old.type !== tombstone.type) reports.push('tombstone_type_conflict'); continue; }
            person.tombstones.push({ ...tombstone, deletedRevision: next.revision }); reports.push('incoming_tombstone_rebased');
        }
        for (const method of incoming.methods) {
            if (person.tombstones.some((entry) => entry.id === method.id)) { reports.push('resurrection_blocked'); continue; }
            const old = person.methods.find((entry) => entry.id === method.id);
            if (old) { if (!same(old, method)) reports.push('current_identity_conflict'); continue; }
            person.methods.push(clone(method));
        }
        for (const type of TYPES) {
            if (person.methods.filter((entry) => entry.type === type && entry.primary).length > 1) {
                person.methods = person.methods.filter((entry) => entry.type !== type).concat(original.methods.filter((entry) => entry.type === type));
                reports.push('primary_type_candidate_rejected');
            }
        }
    }
    // A full parse is mandatory: e.g. >128 methods is a rejected preview, never partial success.
    return { expectedRevision: current.revision, envelope: strictEnvelope(next), reports };
}

/** Fake Plugin state is memory only. Counters count actual attempts, including failures. */
export function createMemoryPlugin(initial = null) {
    let value = clone(initial);
    const readFaults = [], saveFaults = [];
    const counts = { storageReads: 0, storageWrites: 0, factSaveAttempts: 0, issuedSaveAttempts: 0 };
    return {
        counts, readFaults, saveFaults,
        peek: () => clone(value),
        // Deliberate adversarial storage corruption is fixture-only, not a recovery API.
        corrupt: (replacement) => { value = clone(replacement); },
        async loadData() {
            counts.storageReads += 1;
            const fault = readFaults.shift();
            if (fault === 'throw') fail('synthetic_read_error');
            if (fault && typeof fault === 'object') return clone(fault.value);
            return clone(value);
        },
        async saveData(_key, next) {
            counts.storageWrites += 1;
            if (next.requests.length > (value?.requests?.length ?? 0)) counts.factSaveAttempts += 1;
            if (next.requests.some((request) => request.state === 'issued' && value?.requests?.find((old) => old.id === request.id)?.state !== 'issued')) counts.issuedSaveAttempts += 1;
            const fault = saveFaults.shift() ?? 'normal';
            if (fault === 'throw_before') fail('synthetic_save_error');
            if (fault !== 'drop') value = clone(next);
            if (fault === 'apply_throw') fail('synthetic_save_response_lost');
            if (fault === 'read_throw') readFaults.unshift('throw');
        },
    };
}
export function createMockAv(target, initialValue) {
    let currentTarget = clone(target), value = initialValue;
    const faults = [], readFaults = [], counts = { reads: 0, writes: 0 };
    return {
        counts, faults, readFaults,
        changeTarget: (next) => { currentTarget = clone(next); },
        edit: (next) => { value = next; },
        peek: () => ({ target: clone(currentTarget), value }),
        async read() { counts.reads += 1; if (readFaults.shift() === 'throw') fail('synthetic_native_read_error'); return { target: clone(currentTarget), value }; },
        async write(next) {
            counts.writes += 1;
            const fault = faults.shift() ?? 'normal';
            if (fault === 'rejected') return { kind: 'rejected' }; // the sole definitely-not-applied result
            if (fault === 'throw_before') fail('synthetic_transport_unknown');
            value = next;
            if (fault === 'apply_throw') fail('synthetic_transport_unknown');
            return { kind: 'applied' };
        },
    };
}
function checkTransition(old, next, type, factsRevision) {
    if (old.docId !== next.docId) fail('document_changed');
    for (const method of old.methods) {
        const replacement = next.methods.find((entry) => entry.id === method.id);
        if (replacement && replacement.type !== method.type) fail('method_type_changed');
        if (!replacement && !next.tombstones.some((entry) => entry.id === method.id && entry.type === method.type)) fail('missing_delete_tombstone');
    }
    for (const tombstone of old.tombstones) if (!next.tombstones.some((entry) => same(entry, tombstone))) fail('tombstone_removed_or_changed');
    for (const tombstone of next.tombstones.filter((entry) => !old.tombstones.some((prior) => prior.id === entry.id))) {
        if (tombstone.deletedRevision !== factsRevision || !old.methods.some((method) => method.id === tombstone.id && method.type === tombstone.type)
            || next.methods.some((method) => method.id === tombstone.id)) fail('invalid_confirmed_delete');
    }
    const other = (person) => ({ methods: person.methods.filter((entry) => entry.type !== type), tombstones: person.tombstones.filter((entry) => entry.type !== type) });
    if (!same(other(canonicalPerson(old)), other(canonicalPerson(next)))) fail('out_of_scope_fact_change');
}
export function createResearchSession(plugin, av, key = STORE_KEY) {
    // Deliberately session-local. Losing this map before a missing first checkpoint is an unresolved boundary.
    const uncertain = new Map();
    const scope = (target) => `${target.doc}/${target.type}`;
    const clearMatchingBarrier = (request) => {
        const barrier = uncertain.get(scope(request.target));
        if (barrier?.id === request.id && barrier.digest === request.digest) uncertain.delete(scope(request.target));
    };
    const read = async () => {
        const raw = await loadJsonStrict(plugin, key);
        if (raw === null) fail('missing_store_not_initialization');
        return strictEnvelope(raw);
    };
    async function persist(envelope, request) {
        try { await saveJsonVerified(plugin, key, envelope); return true; }
        catch { if (request) uncertain.set(scope(request.target), clone(request)); return false; }
    }
    async function stateChange(envelope, request, state) {
        const next = clone(envelope); next.revision += 1;
        next.requests.find((entry) => entry.id === request.id).state = state;
        if (!await persist(strictEnvelope(next), request)) return { status: 'storage_unknown', factSaved: true };
        if (state === 'verified') clearMatchingBarrier(request);
        return { status: state, factSaved: true };
    }
    async function inspect(envelope, request) {
        if (request.state === 'verified') { clearMatchingBarrier(request); return { status: 'verified', factSaved: true }; }
        const native = await av.read(request.target);
        if (!same(native.target, request.target)) return { status: 'target_changed', factSaved: true };
        if (native.value === request.desired) return stateChange(envelope, request, 'verified');
        if (native.value !== request.baseline) return { status: 'native_conflict', factSaved: true };
        return { status: request.state === 'prepared' || request.state === 'rejected' ? 'explicit_projection_required' : 'unknown_read_only', factSaved: true };
    }
    return {
        async initialize(...args) {
            if (args.length) fail('initialization_accepts_no_business_data');
            const initial = strictEnvelope({ researchFormat: FORMAT, revision: 0, people: [], requests: [] });
            return withStoreLock(key, async () => {
                if (await loadJsonStrict(plugin, key) !== null) fail('store_already_exists');
                if (!await persist(initial)) return { status: 'initialization_unknown' };
                return { status: 'initialized' };
            });
        },
        async confirm(input) {
            // Copy/freeze synchronously BEFORE entering the async lock queue.
            object(input, ['id', 'expectedRevision', 'person', 'target', 'baseline', 'desired']);
            identity(input.id); integer(input.expectedRevision); validateTarget(input.target);
            text(input.baseline, 4096, true); text(input.desired, 4096, true);
            validatePerson(input.person, input.expectedRevision + 1);
            const proposed = frozen({ id: input.id, factsRevision: input.expectedRevision + 1, state: 'prepared', target: clone(input.target), baseline: input.baseline, desired: input.desired, confirmed: canonicalPerson(input.person) });
            const request = frozen({ ...proposed, digest: requestDigest(proposed) });
            validateRequest(request, request.factsRevision, [request.confirmed]);
            return withStoreLock(key, async () => {
                const envelope = await read();
                const idBarrier = [...uncertain.values()].find((entry) => entry.id === request.id);
                if (idBarrier && idBarrier.digest !== request.digest) fail('request_id_payload_conflict');
                const barrier = uncertain.get(scope(request.target));
                if (barrier && (barrier.id !== request.id || barrier.digest !== request.digest)) fail('unknown_scope_barrier');
                const existing = envelope.requests.find((entry) => entry.id === request.id);
                if (existing) {
                    if (existing.digest !== request.digest) fail('request_id_payload_conflict');
                    return inspect(envelope, existing);
                }
                if (barrier) return { status: 'missing_unknown_checkpoint', factSaved: 'unknown' };
                if (envelope.requests.some((entry) => scope(entry.target) === scope(request.target) && entry.state !== 'verified')) fail('unresolved_scope_request');
                if (envelope.revision !== request.factsRevision - 1) fail('stale_preview_revision');
                const current = envelope.people.find((person) => person.docId === request.target.doc);
                if (!current) fail('unresolved_document');
                checkTransition(current, request.confirmed, request.target.type, request.factsRevision);
                const next = clone(envelope); next.revision += 1;
                next.people[next.people.findIndex((person) => person.docId === request.target.doc)] = clone(request.confirmed);
                next.requests.push(clone(request));
                if (!await persist(strictEnvelope(next), request)) return { status: 'storage_unknown', factSaved: 'unknown' };
                return { status: 'prepared', factSaved: true };
            });
        },
        async recover(id) {
            identity(id);
            return withStoreLock(key, async () => {
                const envelope = await read(), request = envelope.requests.find((entry) => entry.id === id);
                if (!request) return { status: [...uncertain.values()].some((entry) => entry.id === id) ? 'missing_unknown_checkpoint' : 'checkpoint_not_found', factSaved: 'unknown' };
                return inspect(envelope, request);
            });
        },
        async project(id) {
            identity(id);
            return withStoreLock(key, async () => {
                let envelope = await read(), request = envelope.requests.find((entry) => entry.id === id);
                if (!request) fail('checkpoint_not_found');
                if (uncertain.has(scope(request.target)) || !['prepared', 'rejected'].includes(request.state)) return inspect(envelope, request);
                const native = await av.read(request.target);
                if (!same(native.target, request.target)) return { status: 'target_changed', factSaved: true };
                if (native.value === request.desired) return stateChange(envelope, request, 'verified');
                if (native.value !== request.baseline) return { status: 'native_conflict', factSaved: true };
                const issued = clone(envelope); issued.revision += 1;
                issued.requests.find((entry) => entry.id === id).state = 'issued';
                if (!await persist(strictEnvelope(issued), request)) return { status: 'storage_unknown', factSaved: true };
                envelope = strictEnvelope(issued); request = envelope.requests.find((entry) => entry.id === id);
                let result;
                try { result = await av.write(request.desired, request.target); }
                catch { return stateChange(envelope, request, 'unknown'); }
                if (result?.kind === 'rejected') return stateChange(envelope, request, 'rejected');
                const verified = await av.read(request.target);
                if (same(verified.target, request.target) && verified.value === request.desired) return stateChange(envelope, request, 'verified');
                return stateChange(envelope, request, 'unknown');
            });
        },
        read,
    };
}

const DOC = '20261017000000-aaaaaaa';
const TARGET = { workspace: 'workspace-a', notebook: 'notebook-a', dbBlock: 'db-a', av: 'av-a', item: 'item-a', doc: DOC, column: 'phone-a', type: 'phone' };
const method = (id = 'method-a', overrides = {}) => ({ id, type: 'phone', value: '+00 111', label: 'work', order: 0, primary: true, ...overrides });
const person = (methods = [method()], tombstones = []) => ({ docId: DOC, methods, tombstones });
const envelope = (people = [person()], revision = 0) => ({ researchFormat: FORMAT, revision, people, requests: [] });
const backup = (people = [person()], revision = 0) => ({ researchFormat: BACKUP_FORMAT, revision, people });
const confirmation = (overrides = {}) => ({ id: 'request-a', expectedRevision: 0, person: person([method('method-a', { value: '+00 222' })]), target: clone(TARGET), baseline: '+00 111', desired: '+00 222', ...overrides });

/** Fixed categories and counts only; no contact payload appears in the artifact. */
export async function runResearch() {
    const started = performance.now(), cases = [];
    let fixtures = [];
    async function scenario(category, action) {
        fixtures = [];
        try {
            await action();
            cases.push({ category, passed: true, counts: fixtures.reduce((counts, entry) => ({
                storageReads: counts.storageReads + entry.plugin.counts.storageReads,
                storageWrites: counts.storageWrites + entry.plugin.counts.storageWrites,
                factSaveAttempts: counts.factSaveAttempts + entry.plugin.counts.factSaveAttempts,
                issuedSaveAttempts: counts.issuedSaveAttempts + entry.plugin.counts.issuedSaveAttempts,
                avReads: counts.avReads + entry.av.counts.reads,
                avWrites: counts.avWrites + entry.av.counts.writes,
            }), { storageReads: 0, storageWrites: 0, factSaveAttempts: 0, issuedSaveAttempts: 0, avReads: 0, avWrites: 0 }) });
        }
        catch (error) { cases.push({ category, passed: false, error: error instanceof assert.AssertionError ? 'assertion_failed' : 'unexpected_error' }); throw error; }
    }
    const invalid = [
        ['unknown_version', (e) => { e.researchFormat = 'future'; }],
        ['unknown_field', (e) => { e.extra = true; }],
        ['missing_field', (e) => { delete e.requests; }],
        ['bad_revision', (e) => { e.revision = -1; }],
        ['duplicate_person', (e) => { e.people.push(clone(e.people[0])); }],
        ['duplicate_method', (e) => { e.people[0].methods.push(clone(e.people[0].methods[0])); }],
        ['bad_type', (e) => { e.people[0].methods[0].type = 'fax'; }],
        ['empty_value', (e) => { e.people[0].methods[0].value = ' '; }],
        ['control_value', (e) => { e.people[0].methods[0].value = 'a\nb'; }],
        ['unicode_control_value', (e) => { e.people[0].methods[0].value = 'a\u0085b'; }],
        ['unicode_control_label', (e) => { e.people[0].methods[0].label = 'a\u009fb'; }],
        ['long_value', (e) => { e.people[0].methods[0].value = 'x'.repeat(4097); }],
        ['long_label', (e) => { e.people[0].methods[0].label = 'x'.repeat(129); }],
        ['bad_order', (e) => { e.people[0].methods[0].order = 0.5; }],
        ['multiple_primary', (e) => { e.people[0].methods.push(method('method-b')); }],
        ['bad_tombstone', (e) => { e.people[0].tombstones.push({ id: 'old', type: 'fax', deletedRevision: 0 }); }],
        ['future_tombstone', (e) => { e.people[0].tombstones.push({ id: 'old', type: 'phone', deletedRevision: 1 }); }],
        ['live_tombstone_collision', (e) => { e.people[0].tombstones.push({ id: 'method-a', type: 'phone', deletedRevision: 0 }); }],
        ['method_count_limit', (e) => { e.people[0].methods = Array.from({ length: 129 }, (_, i) => method(`m-${i}`, { primary: false })); }],
    ];
    for (const [category, mutate] of invalid) await scenario(`strict_${category}`, async () => {
        const input = envelope(); mutate(input); const before = JSON.stringify(input);
        assert.throws(() => strictEnvelope(input)); assert.equal(JSON.stringify(input), before);
    });
    await scenario('strict_string_envelope_rejected', async () => { assert.throws(() => strictEnvelope(JSON.stringify(envelope()))); });
    await scenario('strict_independent_clone_stable_order_limits', async () => {
        const input = envelope([person([method('b', { order: 1, primary: false, value: 'x'.repeat(4096), label: 'x'.repeat(128) }), method('a', { order: 1 })])]);
        const parsed = strictEnvelope(input); input.people[0].methods[0].value = 'changed';
        assert.deepEqual(parsed.people[0].methods.map((entry) => entry.id), ['a', 'b']);
        assert.equal(parsed.people[0].methods[1].value.length, 4096); assert.ok(Object.isFrozen(parsed.people[0].methods[0]));
        for (const type of TYPES) strictEnvelope(envelope([person([method('m', { type, primary: false })])]));
    });
    await scenario('backup_old_empty_preserves_current', async () => {
        const current = envelope(), old = backup([]); const before = JSON.stringify({ current, old });
        const out = previewBackup(current, old, new Set([DOC]));
        assert.deepEqual(out.envelope.people, current.people); assert.equal(JSON.stringify({ current, old }), before);
    });
    await scenario('backup_current_content_and_tombstones_win', async () => {
        const current = envelope([person([method()], [{ id: 'deleted', type: 'phone', deletedRevision: 1 }])], 3);
        const old = backup([person([method('method-a', { value: '+00 old' }), method('deleted', { primary: false })])]);
        const out = previewBackup(current, old, new Set([DOC]));
        assert.deepEqual(out.envelope.people, current.people); assert.deepEqual(out.reports.sort(), ['current_identity_conflict', 'resurrection_blocked']);
    });
    await scenario('backup_tombstone_rebase_persists_second_restore_barrier', async () => {
        const imported = backup([person([], [{ id: 'deleted', type: 'phone', deletedRevision: 99 }])], 100);
        const out = previewBackup(envelope(), imported, new Set([DOC]));
        assert.equal(out.envelope.revision, 1); assert.deepEqual(out.envelope.people[0].tombstones, [{ id: 'deleted', type: 'phone', deletedRevision: 1 }]);
        const second = previewBackup(out.envelope, backup([person([method('deleted', { primary: false })])]), new Set([DOC]));
        assert.equal(second.envelope.people[0].methods.length, 1); assert.ok(second.reports.includes('resurrection_blocked'));
        assert.equal(imported.people[0].tombstones[0].deletedRevision, 99);
    });
    await scenario('backup_incoming_tombstone_cannot_delete_current', async () => {
        const out = previewBackup(envelope(), backup([person([], [{ id: 'method-a', type: 'phone', deletedRevision: 0 }])]), new Set([DOC]));
        assert.deepEqual(out.envelope.people[0], person()); assert.deepEqual(out.reports, ['incoming_tombstone_conflict']);
    });
    await scenario('backup_primary_conflict_rejects_affected_type', async () => {
        const out = previewBackup(envelope(), backup([person([method('new-primary')])]), new Set([DOC]));
        assert.deepEqual(out.envelope.people[0].methods, [method()]); assert.ok(out.reports.includes('primary_type_candidate_rejected'));
    });
    await scenario('backup_unresolved_no_name_matching_and_no_requests', async () => {
        const out = previewBackup(envelope([]), backup(), new Set()); assert.deepEqual(out.envelope.people, []); assert.deepEqual(out.reports, ['unresolved_document']);
        assert.throws(() => strictBackup({ ...backup(), requests: [] }));
    });
    function fixture(initial = envelope()) {
        const plugin = createMemoryPlugin(initial), av = createMockAv(TARGET, '+00 111');
        const result = { plugin, av, session: createResearchSession(plugin, av) }; fixtures.push(result); return result;
    }
    await scenario('missing_or_corrupt_store_and_read_error_zero_business_writes', async () => {
        for (const initial of [null, 'bad', { invalid: true }]) {
            const { plugin, av, session } = fixture(initial);
            await assert.rejects(session.confirm(confirmation())); assert.equal(plugin.counts.storageWrites, 0); assert.equal(av.counts.writes, 0);
        }
        const { plugin, session } = fixture(); plugin.readFaults.push('throw');
        await assert.rejects(session.confirm(confirmation())); assert.equal(plugin.counts.storageWrites, 0);
    });
    await scenario('explicit_initialization_only', async () => {
        const { plugin, session } = fixture(null); await assert.rejects(session.initialize([person()])); assert.equal(plugin.counts.storageWrites, 0);
        assert.equal((await session.initialize()).status, 'initialized'); assert.deepEqual(plugin.peek().people, []);
        await assert.rejects(session.initialize()); assert.equal(plugin.counts.storageWrites, 1);
    });
    await scenario('confirm_primary_mismatch_and_type_change_zero_writes', async () => {
        const { plugin, session } = fixture();
        await assert.rejects(session.confirm(confirmation({ desired: 'unconfirmed' })));
        const changed = person([method('method-a', { type: 'email', value: 'a@example.test' })]);
        await assert.rejects(session.confirm(confirmation({ person: changed, desired: '' })));
        assert.equal(plugin.counts.storageWrites, 0);
    });
    await scenario('deletion_tombstone_no_auto_primary_and_empty_projection', async () => {
        const { plugin, av, session } = fixture(envelope([person([method(), method('secondary', { primary: false })])]));
        const deleted = person([method('secondary', { primary: false })], [{ id: 'method-a', type: 'phone', deletedRevision: 1 }]);
        assert.equal((await session.confirm(confirmation({ person: deleted, desired: '' }))).status, 'prepared');
        assert.equal(av.counts.writes, 0); assert.equal((await session.project('request-a')).status, 'verified');
        assert.equal(av.peek().value, ''); assert.equal(plugin.peek().people[0].methods[0].primary, false);
    });
    await scenario('confirmed_delete_requires_removed_live_id_and_current_generation', async () => {
        const { plugin, session } = fixture();
        await assert.rejects(session.confirm(confirmation({ person: person([], [{ id: 'method-a', type: 'phone', deletedRevision: 0 }]), desired: '' })), /invalid_confirmed_delete/);
        await assert.rejects(session.confirm(confirmation({ person: person([method('method-a', { value: '+00 222' })], [{ id: 'never-existed', type: 'phone', deletedRevision: 1 }]) })), /invalid_confirmed_delete/);
        assert.equal(plugin.counts.storageWrites, 0);
    });
    await scenario('prepared_recovery_read_only_then_explicit_projection', async () => {
        const { plugin, av, session } = fixture(); await session.confirm(confirmation());
        const restarted = createResearchSession(plugin, av);
        assert.equal((await restarted.recover('request-a')).status, 'explicit_projection_required'); assert.equal(av.counts.writes, 0);
        assert.equal((await restarted.project('request-a')).status, 'verified'); assert.equal(av.counts.writes, 1);
        av.edit('later native edit'); assert.equal((await restarted.project('request-a')).status, 'verified'); assert.equal(av.counts.writes, 1);
    });
    await scenario('same_request_repeated_no_fact_rewrite_and_payload_conflict', async () => {
        const { plugin, av, session } = fixture(); await session.confirm(confirmation()); const saves = plugin.counts.storageWrites;
        await session.confirm(confirmation()); assert.equal(plugin.counts.storageWrites, saves); assert.equal(av.counts.writes, 0);
        await assert.rejects(session.confirm(confirmation({ baseline: 'different' })), /request_id_payload_conflict/);
        await assert.rejects(session.confirm(confirmation({ id: 'request-b', expectedRevision: 1 })), /unresolved_scope_request/);
    });
    await scenario('same_runtime_lock_revision_contention_one_fact_commit', async () => {
        const { plugin, session } = fixture();
        const results = await Promise.allSettled([session.confirm(confirmation()), session.confirm(confirmation({ id: 'request-b' }))]);
        assert.deepEqual(results.map((entry) => entry.status), ['fulfilled', 'rejected']); assert.equal(plugin.counts.factSaveAttempts, 1);
    });
    await scenario('freeze_before_async_lock_does_not_follow_mutated_input', async () => {
        const { plugin, session } = fixture(); const input = confirmation(); const promise = session.confirm(input);
        input.person.methods[0].value = 'mutated'; input.target.item = 'changed'; input.desired = 'mutated'; input.expectedRevision = 77;
        await promise; assert.equal(plugin.peek().requests[0].target.item, 'item-a'); assert.equal(plugin.peek().people[0].methods[0].value, '+00 222');
    });
    await scenario('queued_mutable_expected_revision_cannot_bypass_stale_preview', async () => {
        const { plugin, session } = fixture();
        let release, entered;
        const gate = new Promise((resolveGate) => { release = resolveGate; });
        const entry = new Promise((resolveEntry) => { entered = resolveEntry; });
        const prior = withStoreLock(STORE_KEY, async () => {
            entered(); await gate;
            await saveJsonVerified(plugin, STORE_KEY, envelope([person()], 1));
        });
        await entry;
        const input = confirmation(), queued = session.confirm(input);
        input.expectedRevision = 1;
        try { release(); await prior; await assert.rejects(queued, /stale_preview_revision/); }
        finally { release(); await prior; }
        assert.equal(plugin.counts.storageWrites, 1); assert.equal(plugin.peek().requests.length, 0);
    });
    await scenario('strict_pending_snapshot_and_backup_cannot_change_frozen_scope', async () => {
        const { plugin, session } = fixture(); await session.confirm(confirmation());
        const input = plugin.peek(); input.people[0].methods[0].value = 'unconfirmed';
        assert.throws(() => strictEnvelope(input), /pending_facts_changed/);
        assert.throws(() => previewBackup(plugin.peek(), backup([person([method('extra', { primary: false })])]), new Set([DOC])), /pending_facts_changed/);
        assert.equal(plugin.counts.storageWrites, 1);
    });
    await scenario('strict_request_identity_target_state_and_digest_reject', async () => {
        const { plugin, session } = fixture(); await session.confirm(confirmation());
        for (const mutate of [
            (e) => { e.requests.push(clone(e.requests[0])); },
            (e) => { e.requests[0].state = 'maybe'; },
            (e) => { delete e.requests[0].target.notebook; },
            (e) => { e.requests[0].target.workspace = ''; },
            (e) => { e.requests[0].desired = 'forged'; },
            (e) => { e.requests[0].digest = 'forged'; },
            (e) => { e.requests[0].extra = true; },
        ]) { const bad = plugin.peek(); mutate(bad); assert.throws(() => strictEnvelope(bad)); }
        assert.equal(plugin.counts.storageWrites, 1);
    });
    for (const fault of ['apply_throw', 'read_throw', 'throw_before']) await scenario(`fact_save_${fault}_zero_av_unknown_not_replayed`, async () => {
        const { plugin, av, session } = fixture(); plugin.saveFaults.push(fault);
        assert.equal((await session.confirm(confirmation())).status, 'storage_unknown');
        assert.equal(plugin.counts.storageWrites, 1); assert.equal(av.counts.writes, 0);
        const before = plugin.counts.storageWrites; await session.confirm(confirmation());
        await assert.rejects(session.confirm(confirmation({ id: 'request-b' })), /unknown_scope_barrier/);
        assert.equal(plugin.counts.storageWrites, before); assert.equal(av.counts.writes, 0);
        if (plugin.peek().requests.length) { await session.project('request-a'); assert.equal(av.counts.writes, 0); }
    });
    await scenario('fact_save_nonconvergence_exactly_two_attempts_zero_av', async () => {
        const { plugin, av, session } = fixture(); plugin.saveFaults.push('drop', 'drop');
        assert.equal((await session.confirm(confirmation())).status, 'storage_unknown'); assert.equal(plugin.counts.storageWrites, 2); assert.equal(av.counts.writes, 0);
        assert.equal((await session.recover('request-a')).status, 'missing_unknown_checkpoint');
    });
    await scenario('missing_unknown_request_id_cannot_be_reassigned_to_other_scope', async () => {
        const { plugin, av, session } = fixture(); plugin.saveFaults.push('throw_before'); await session.confirm(confirmation());
        const emailPerson = person([method(), method('email-a', { type: 'email', value: 'new@example.test' })]);
        await assert.rejects(session.confirm(confirmation({ person: emailPerson,
            target: { ...TARGET, column: 'email-column', type: 'email' }, baseline: '', desired: 'new@example.test' })), /request_id_payload_conflict/);
        assert.equal(plugin.counts.storageWrites, 1); assert.equal(av.counts.writes, 0);
    });
    await scenario('fact_readback_mismatch_can_converge_on_second_identical_save', async () => {
        const { plugin, session } = fixture(); plugin.saveFaults.push('drop');
        assert.equal((await session.confirm(confirmation())).status, 'prepared'); assert.equal(plugin.counts.storageWrites, 2);
    });
    for (const fault of ['apply_throw', 'read_throw', 'throw_before']) await scenario(`issued_save_${fault}_zero_av_and_restart_no_replay`, async () => {
        const { plugin, av, session } = fixture(); await session.confirm(confirmation()); plugin.saveFaults.push(fault);
        assert.equal((await session.project('request-a')).status, 'storage_unknown'); assert.equal(av.counts.writes, 0);
        await session.project('request-a'); assert.equal(av.counts.writes, 0);
        const restarted = createResearchSession(plugin, av); await restarted.recover('request-a'); assert.equal(av.counts.writes, 0);
        if (plugin.peek().requests[0].state === 'issued') { await restarted.project('request-a'); assert.equal(av.counts.writes, 0); }
    });
    await scenario('target_changes_all_frozen_dimensions_stop_projection', async () => {
        for (const field of TARGET_KEYS.filter((entry) => entry !== 'type')) {
            const { av, session } = fixture(); await session.confirm(confirmation()); av.changeTarget({ ...TARGET, [field]: field === 'doc' ? '20261017000000-bbbbbbb' : 'changed' });
            assert.equal((await session.project('request-a')).status, 'target_changed'); assert.equal(av.counts.writes, 0);
        }
        const { av, session } = fixture(); await session.confirm(confirmation()); av.edit('third value');
        assert.equal((await session.project('request-a')).status, 'native_conflict'); assert.equal(av.counts.writes, 0);
    });
    await scenario('already_desired_read_only_close', async () => {
        const { av, session } = fixture(); await session.confirm(confirmation()); av.edit('+00 222');
        assert.equal((await session.project('request-a')).status, 'verified'); assert.equal(av.counts.writes, 0);
    });
    await scenario('transport_unknown_baseline_and_restart_never_replay', async () => {
        const { plugin, av, session } = fixture(); await session.confirm(confirmation()); av.faults.push('throw_before');
        assert.equal((await session.project('request-a')).status, 'unknown'); assert.equal(av.counts.writes, 1);
        const restarted = createResearchSession(plugin, av);
        assert.equal((await restarted.recover('request-a')).status, 'unknown_read_only');
        assert.equal((await restarted.project('request-a')).status, 'unknown_read_only'); assert.equal(av.counts.writes, 1);
        await assert.rejects(restarted.confirm(confirmation({ id: 'request-b', expectedRevision: plugin.peek().revision })), /unresolved_scope_request/);
    });
    await scenario('transport_applied_response_lost_read_only_restart_verifies', async () => {
        const { plugin, av, session } = fixture(); await session.confirm(confirmation()); av.faults.push('apply_throw');
        assert.equal((await session.project('request-a')).status, 'unknown');
        assert.equal((await createResearchSession(plugin, av).recover('request-a')).status, 'verified'); assert.equal(av.counts.writes, 1);
    });
    await scenario('native_read_failure_after_write_keeps_issued_not_rejected', async () => {
        const { plugin, av, session } = fixture(); await session.confirm(confirmation()); av.readFaults.push('normal', 'throw');
        await assert.rejects(session.project('request-a'), /synthetic_native_read_error/);
        assert.equal(plugin.peek().requests[0].state, 'issued'); assert.equal(av.counts.writes, 1);
        assert.equal((await createResearchSession(plugin, av).recover('request-a')).status, 'verified'); assert.equal(av.counts.writes, 1);
    });
    await scenario('native_preflight_read_failure_no_write_or_rejected', async () => {
        const { plugin, av, session } = fixture(); await session.confirm(confirmation()); av.readFaults.push('throw');
        await assert.rejects(session.project('request-a'), /synthetic_native_read_error/);
        assert.equal(av.counts.writes, 0); assert.equal(plugin.peek().requests[0].state, 'prepared');
        assert.equal(plugin.counts.storageWrites, 1);
    });
    await scenario('native_recovery_read_failure_never_replays_issued', async () => {
        const { plugin, av, session } = fixture(); await session.confirm(confirmation()); av.readFaults.push('normal', 'throw');
        await assert.rejects(session.project('request-a'));
        const restarted = createResearchSession(plugin, av); av.readFaults.push('throw');
        await assert.rejects(restarted.recover('request-a'), /synthetic_native_read_error/);
        assert.equal(plugin.peek().requests[0].state, 'issued'); assert.equal(plugin.peek().people[0].methods[0].value, '+00 222');
        assert.equal(av.counts.writes, 1);
        assert.equal((await restarted.recover('request-a')).status, 'verified'); assert.equal(av.counts.writes, 1);
    });
    for (const fault of ['apply_throw', 'read_throw']) await scenario(`verified_save_${fault}_recovery_releases_only_matching_barrier`, async () => {
        const { plugin, av, session } = fixture(); await session.confirm(confirmation()); plugin.saveFaults.push('normal', fault);
        assert.equal((await session.project('request-a')).status, 'storage_unknown'); assert.equal(plugin.peek().requests[0].state, 'verified');
        assert.equal(av.counts.writes, 1); assert.equal((await session.recover('request-a')).status, 'verified');
        const next = confirmation({ id: 'request-b', expectedRevision: plugin.peek().revision,
            person: person([method('method-a', { value: '+00 333' })]), baseline: '+00 222', desired: '+00 333' });
        plugin.saveFaults.push('throw_before'); assert.equal((await session.confirm(next)).status, 'storage_unknown');
        // Reading old completed A must not erase B's later unknown checkpoint barrier.
        await session.recover('request-a');
        await assert.rejects(session.confirm({ ...next, id: 'request-c' }), /unknown_scope_barrier/);
        assert.equal(av.counts.writes, 1);
    });
    await scenario('definite_rejection_requires_explicit_fresh_retry_original', async () => {
        const { plugin, av, session } = fixture(); await session.confirm(confirmation()); av.faults.push('rejected');
        assert.equal((await session.project('request-a')).status, 'rejected');
        const restarted = createResearchSession(plugin, av); await restarted.recover('request-a'); assert.equal(av.counts.writes, 1);
        assert.equal((await restarted.project('request-a')).status, 'verified'); assert.equal(av.counts.writes, 2);
    });
    await scenario('missing_unknown_checkpoint_restart_boundary_is_explicit', async () => {
        const { plugin, av, session } = fixture(); plugin.saveFaults.push('throw_before'); await session.confirm(confirmation());
        assert.equal((await session.recover('request-a')).status, 'missing_unknown_checkpoint');
        const restarted = createResearchSession(plugin, av); assert.equal((await restarted.recover('request-a')).status, 'checkpoint_not_found');
        // No automatic initialization, new confirmation or AV retry is authorized by recovery.
        assert.equal(plugin.counts.storageWrites, 1); assert.equal(av.counts.writes, 0);
    });
    await scenario('caller_timeout_does_not_release_underlying_store_lock', async () => {
        let release;
        const gate = new Promise((resolveGate) => { release = resolveGate; });
        const trace = [];
        const underlying = withStoreLock('synthetic-s2-timeout-gate', async () => {
            trace.push('first-enter'); await gate; trace.push('first-commit');
        });
        try {
            await assert.rejects(withTimeout(() => underlying, 5, 'synthetic-wait'));
            const second = withStoreLock('synthetic-s2-timeout-gate', async () => { trace.push('second-enter'); });
            await Promise.resolve(); assert.deepEqual(trace, ['first-enter']);
            release(); await Promise.all([underlying, second]);
            assert.deepEqual(trace, ['first-enter', 'first-commit', 'second-enter']);
        } finally { release(); await underlying; }
    });
    const result = {
        task: 'AG-RF-004-S2', syntheticOnly: true, candidateContractAccepted: false, productionChanges: false,
        kernelRequests: 0, realPluginFileWrites: 0, isolation: 'same-runtime memory queues and fake AV only',
        summary: { total: cases.length, passed: cases.filter((entry) => entry.passed).length, failed: cases.filter((entry) => !entry.passed).length },
        scenarios: cases,
        limits: ['no CAS or native atomic JSON/AV transaction', 'no true cross-window or cross-process lock proof', 'no delayed-host-write guarantee', 'missing first checkpoint barrier survives only in current session', 'backup is zero-write preview only', 'confirmed facts source remains undecided', 'bounded synthetic fixtures, no large-store budget claim'],
        elapsedMs: Number((performance.now() - started).toFixed(3)),
    };
    return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = await runResearch();
    writeFileSync(new URL('./contact-methods-recovery-research-results.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result.summary));
    if (result.summary.failed) process.exitCode = 1;
}
