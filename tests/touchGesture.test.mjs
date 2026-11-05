import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

async function fixture() {
    const filters = new Map();
    const idles = new Map();
    let nextId = 1;
    class Actor {
        constructor(properties) { Object.assign(this, properties); this.handlers = new Map(); }
        connect(signal, callback) {
            const id = nextId++;
            this.handlers.set(id, {signal, callback});
            return id;
        }
        disconnect(id) { this.handlers.delete(id); }
        emit(signal, ...args) {
            let result;
            for (const handler of this.handlers.values()) {
                if (handler.signal === signal)
                    result = handler.callback(this, ...args);
            }
            return result;
        }
        set_position(x, y) { this.x = x; this.y = y; }
        set_size(width, height) { this.width = width; this.height = height; }
        hide() { this.visible = false; }
        destroy() { this.destroyed = true; }
    }
    const Clutter = {
        Actor,
        EventType: {TOUCH_BEGIN: 'begin', TOUCH_UPDATE: 'update', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel'},
        EVENT_PROPAGATE: false, EVENT_STOP: true,
        Event: {
            add_filter(_stage, callback) { const id = nextId++; filters.set(id, callback); return id; },
            remove_filter(id) { filters.delete(id); },
        },
    };
    const GLib = {
        PRIORITY_DEFAULT_IDLE: 0, SOURCE_REMOVE: false,
        idle_add(_priority, callback) { const id = nextId++; idles.set(id, callback); return id; },
        source_remove(id) { idles.delete(id); },
    };
    let actor;
    const layoutManager = {
        addChrome(value) { actor = value; },
        removeChrome(value) { assert.equal(value, actor); },
    };
    const context = vm.createContext({
        global: {stage: {grab() { throw new Error('A client touch must never be cancelled by a stage grab'); }}},
    });
    const state = new vm.SourceTextModule(await readFile(new URL('../touchState.js', import.meta.url), 'utf8'), {context});
    const gesture = new vm.SourceTextModule(await readFile(new URL('../touchGesture.js', import.meta.url), 'utf8'), {context});
    await gesture.link(specifier => {
        if (specifier === './touchState.js')
            return state;
        const exports = specifier.endsWith('/main.js') ? {layoutManager}
            : {default: specifier === 'gi://Clutter' ? Clutter : GLib};
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports))
                this.setExport(key, value);
        }, {context});
    });
    await gesture.evaluate();
    let allowed = true;
    let pointerVisible = false;
    const cursor = new Actor({});
    cursor.get_pointer_visible = () => pointerVisible;
    const monitor = {x: 0, y: 0, width: 1024};
    const reveals = [];
    const contacts = [];
    const instance = new gesture.namespace.TouchRevealGesture(
        () => monitor, () => allowed, slot => reveals.push(slot), e => contacts.push(e), cursor);
    const routed = new Set();
    return {
        instance, actor, filters, idles, cursor, monitor, reveals, contacts,
        setAllowed(value) { allowed = value; instance.sync(); },
        setPointerVisible(value) { pointerVisible = value; cursor.emit('visibility-changed'); },
        flush() {
            for (const [id, callback] of idles) { idles.delete(id); callback(); }
        },
        dispatch(type, slot = 0, x = 400, y = 2, edge = true) {
            const e = {type: () => type, get_event_sequence: () => ({get_slot: () => slot}), get_coords: () => [x, y]};
            for (const callback of filters.values())
                assert.equal(callback(e), false, 'observer must not consume client input');
            if (type === 'begin' && edge && actor.reactive)
                routed.add(slot);
            const result = routed.has(slot) ? actor.emit('touch-event', e) : false;
            if (type === 'end' || type === 'cancel')
                routed.delete(slot);
            return result;
        },
    };
}

test('edge owns the touch from BEGIN and reveals only after 32 pixels', async () => {
    const f = await fixture();
    assert.equal(f.dispatch('begin'), true);
    assert.equal(f.dispatch('update', 0, 400, 33), true);
    assert.equal(f.reveals.length, 0);
    assert.equal(f.dispatch('update', 0, 400, 34), true);
    assert.deepEqual(f.reveals, [0]);
    f.setAllowed(false);
    assert.equal(f.actor.reactive, true, 'original sequence stays on its starting actor');
    assert.equal(f.dispatch('end'), true);
    f.flush();
    assert.equal(f.actor.reactive, false);
    f.instance.destroy();
});

test('taps, horizontal swipes and multiple fingers do not reveal', async () => {
    const f = await fixture();
    f.dispatch('begin'); f.dispatch('end'); f.flush();
    f.dispatch('begin'); f.dispatch('update', 0, 450, 34); f.dispatch('end'); f.flush();
    f.dispatch('begin'); f.dispatch('begin', 1); f.dispatch('update', 0, 400, 60);
    f.dispatch('end'); f.dispatch('end', 1); f.flush();
    assert.deepEqual(f.reveals, []);
    f.dispatch('begin'); f.dispatch('update', 0, 400, 34);
    assert.deepEqual(f.reveals, [0]);
    f.instance.destroy();
});

test('an existing app contact prevents a second edge contact from revealing', async () => {
    const f = await fixture();
    assert.equal(f.dispatch('begin', 0, 500, 300, false), false);
    f.dispatch('begin', 1); f.dispatch('update', 1, 400, 34);
    assert.deepEqual(f.reveals, []);
    f.instance.destroy();
});

test('mouse and disabled modes leave the screen edge available', async () => {
    const f = await fixture();
    f.setPointerVisible(true);
    assert.equal(f.actor.reactive, false);
    f.setPointerVisible(false);
    assert.equal(f.actor.reactive, true);
    f.setAllowed(false);
    assert.equal(f.actor.reactive, false);
    assert.equal(f.dispatch('begin'), false);
    f.instance.destroy();
});

test('primary-monitor changes update edge geometry in logical coordinates', async () => {
    const f = await fixture();
    Object.assign(f.monitor, {x: -1024, y: -300, width: 1024});
    f.instance.sync();
    assert.deepEqual([f.actor.x, f.actor.y, f.actor.width, f.actor.height], [-1024, -300, 1024, 8]);
    f.dispatch('begin', 0, -500, -298); f.dispatch('update', 0, -500, -266);
    assert.deepEqual(f.reveals, [0]);
    f.instance.destroy();
});

test('destroy removes chrome, observer, cursor listener and queued work', async () => {
    const f = await fixture();
    f.dispatch('begin'); f.dispatch('end');
    assert.equal(f.idles.size, 1);
    f.instance.destroy();
    assert.equal(f.filters.size, 0);
    assert.equal(f.idles.size, 0);
    assert.equal(f.cursor.handlers.size, 0);
    assert.equal(f.actor.destroyed, true);
});
