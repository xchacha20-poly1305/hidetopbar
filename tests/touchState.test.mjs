import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isAtTopEdge, isDownwardSwipe, TouchHold} from '../touchState.js';

function fixture() {
    let nextId = 1;
    let expired = 0;
    let delay = 3;
    const timers = new Map();
    const hold = new TouchHold((seconds, callback) => {
        const id = nextId++;
        timers.set(id, {seconds, callback});
        return id;
    }, id => timers.delete(id), () => delay, () => expired++);
    return {
        hold, timers,
        setDelay(value) { delay = value; },
        get expired() { return expired; },
        expire() {
            assert.equal(timers.size, 1);
            const [id, {callback}] = [...timers][0];
            timers.delete(id);
            callback();
        },
    };
}

test('edge bounds use the primary monitor origin, including negative coordinates', () => {
    const monitor = {x: -1920, y: -100, width: 1920};
    assert.equal(isAtTopEdge(-1920, -100, monitor), true);
    assert.equal(isAtTopEdge(-1, -93, monitor), true);
    for (const [x, y] of [[0, -100], [-1921, -100], [-1, -101], [-1, -92]])
        assert.equal(isAtTopEdge(x, y, monitor), false);
    assert.equal(isAtTopEdge(0, 0, null), false);
});

test('requires 32 logical pixels downward and a strictly dominant vertical axis', () => {
    assert.equal(isDownwardSwipe(100, 4, 100, 36), true);
    assert.equal(isDownwardSwipe(100, 4, 131, 36), true);
    for (const [x, y] of [[100, 35], [132, 36], [160, 36], [100, -40], [100, 4]])
        assert.equal(isDownwardSwipe(100, 4, x, y), false);
});

test('reveal remains held until the gesture releases, then expires once', () => {
    const f = fixture();
    f.hold.reveal('gesture');
    assert.equal(f.hold.active, true);
    assert.equal(f.timers.size, 0);
    f.hold.release('gesture');
    assert.equal([...f.timers.values()][0].seconds, 3);
    f.expire();
    assert.equal(f.hold.active, false);
    assert.equal(f.expired, 1);
});

test('touches pause and restart the delay and every finger must release', () => {
    const f = fixture();
    f.hold.reveal('gesture');
    f.hold.release('gesture');
    const oldId = [...f.timers.keys()][0];
    f.hold.press('a');
    f.hold.press('b');
    assert.equal(f.timers.size, 0);
    f.hold.release('a');
    assert.equal(f.timers.size, 0);
    f.hold.release('b');
    assert.equal(f.timers.size, 1);
    assert.equal(f.timers.has(oldId), false);
    f.hold.release('unrelated');
    assert.equal(f.timers.size, 1);
});

test('menus hold visibility and closing restarts the complete delay', () => {
    const f = fixture();
    f.hold.reveal('gesture');
    f.hold.release('gesture');
    f.hold.setMenuOpen(true);
    assert.equal(f.timers.size, 0);
    f.hold.press('menu');
    f.hold.setMenuOpen(false);
    assert.equal(f.timers.size, 0);
    f.hold.release('menu');
    assert.equal(f.timers.size, 1);
    assert.equal([...f.timers.values()][0].seconds, 3);
    const id = [...f.timers.keys()][0];
    f.hold.setMenuOpen(false);
    assert.equal(f.timers.has(id), true);
});

test('delay changes replace the timer and repeated reveal cancels it', () => {
    const f = fixture();
    f.hold.reveal('gesture');
    f.hold.release('gesture');
    f.setDelay(5);
    f.hold.refresh();
    assert.equal(f.timers.size, 1);
    assert.equal([...f.timers.values()][0].seconds, 5);
    f.hold.reveal('again');
    assert.equal(f.timers.size, 0);
    f.hold.release('again');
    f.expire();
});

test('reset cancels all resources, late releases cannot restart the timer', () => {
    const f = fixture();
    f.hold.reveal('gesture');
    f.hold.release('gesture');
    f.hold.reset();
    f.hold.release('gesture');
    f.hold.refresh();
    f.hold.press('panel');
    assert.equal(f.hold.active, false);
    assert.equal(f.timers.size, 0);
    assert.equal(f.expired, 0);
});
