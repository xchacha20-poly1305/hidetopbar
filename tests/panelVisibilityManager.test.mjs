import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import vm from 'node:vm';

async function fixture() {
    const panel = {
        x: 0, y: 0, width: 1024, height: 32,
        get_pivot_point: () => [0, 0],
        ease() {},
    };
    const main = {
        messageTray: {}, layoutManager: {panelBox: panel, primaryMonitor: {}},
        overview: {visible: false, _overview: {_controls: {}}},
        panel: {menuManager: {}}, actionMode: 1, modalCount: 0,
    };
    let pointer = [400, 0];
    let visible = true;
    const context = vm.createContext({global: {get_pointer: () => pointer, backend: {}}});
    const source = new vm.SourceTextModule(await readFile(new URL('../panelVisibilityManager.js', import.meta.url), 'utf8'), {context});
    let mainModule;
    await source.link(specifier => {
        let exports = {};
        if (specifier.endsWith('/main.js'))
            exports = main;
        else if (specifier.endsWith('/layout.js'))
            exports = {PressureBarrier: class {
                connect() {}
                addBarrier() {}
            }};
        else if (specifier.endsWith('/config.js'))
            exports = {PACKAGE_VERSION: '51.1'};
        else if (specifier === './convenience.js')
            exports = {DEBUG() {}};
        else if (specifier === './touchState.js')
            exports = {TouchHold: class {}};
        else if (specifier === './touchGesture.js')
            exports = {TouchRevealGesture: class {}};
        else if (specifier.startsWith('gi://')) {
            const values = {
                'gi://Shell': {ActionMode: {NORMAL: 1}},
                'gi://Clutter': {
                    AnimationMode: {EASE_OUT_QUAD: 1},
                    ModifierType: {BUTTON1_MASK: 1, BUTTON2_MASK: 2, BUTTON3_MASK: 4,
                        BUTTON4_MASK: 8, BUTTON5_MASK: 16},
                },
                'gi://Meta': {
                    BarrierDirection: {POSITIVE_Y: 1, NEGATIVE_Y: 2},
                    Barrier: class {
                        constructor(params) { Object.assign(this, params); }
                    },
                },
            };
            const value = values[specifier] ?? {};
            exports = {default: value};
        }
        const module = new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports))
                this.setExport(key, value);
        }, {context});
        if (specifier.endsWith('/main.js'))
            mainModule = module;
        return module;
    });
    await source.evaluate();
    const manager = Object.create(source.namespace.PanelVisibilityManager.prototype);
    const settings = new Map([
        ['touch-sensitive', true], ['touch-sensitive-fullscreen-window', true],
    ]);
    Object.assign(manager, {
        _preventHide: false, _touchHold: {active: false, setMenuOpen() {}},
        _cursorTracker: {get_pointer_visible: () => visible, connect: () => 1},
        _staticBox: {x1: 0, x2: 1024, y1: 0, y2: 32},
        _settings: {get_boolean: key => settings.get(key), get_double: () => 0.2,
            get_int: () => 100},
        _base_y: 0, _animationActive: false, _panelHidden: false,
    });
    return {
        manager, main, settings,
        setMain(key, value) { main[key] = value; mainModule.setExport(key, value); },
        setPointer(coords, isVisible) { pointer = coords; visible = isVisible; },
    };
}

test('pressure barrier and pointer dwell leave the top-right window controls clear', async () => {
    const f = await fixture();
    f.main.layoutManager.panelBox.x = 1920;
    f.manager._initPressureBarrier();
    assert.equal(f.manager._panelBarrier.x2, 2880);
    f.setPointer([2879, 0, 0], true);
    assert.equal(f.manager._isPointerAtEdge(), true);
    f.setPointer([2880, 0, 0], true);
    assert.equal(f.manager._isPointerAtEdge(), false);
    f.setPointer([2943, 0, 0], true);
    assert.equal(f.manager._isPointerAtEdge(), false);
});

test('hidden touch cursor at the edge does not prevent auto-hide', async () => {
    const f = await fixture();
    f.setPointer([400, 0], false);
    f.manager.hide(0.2, 'mouse-left');
    assert.equal(f.manager._panelHidden, true);
});

test('visible mouse hovering the panel still prevents auto-hide', async () => {
    const f = await fixture();
    f.manager.hide(0.2, 'mouse-left');
    assert.equal(f.manager._panelHidden, false);
    f.setPointer([400, 200], true);
    f.manager.hide(0.2, 'mouse-left');
    assert.equal(f.manager._panelHidden, true);
});

test('touch hold and existing visibility holds both block hiding', async () => {
    const f = await fixture();
    f.setPointer([400, 200], true);
    f.manager._touchHold.active = true;
    f.manager.hide(0.2, 'intellihide');
    assert.equal(f.manager._panelHidden, false);
    f.manager._touchHold.active = false;
    f.manager._preventHide = true;
    f.manager.hide(0.2, 'mouse-left');
    assert.equal(f.manager._panelHidden, false);
});

test('touch reveal respects fullscreen, overview and modal restrictions independently of mouse', async () => {
    const f = await fixture();
    f.manager._panelHidden = true;
    assert.equal(f.manager._canRevealWithTouch(), true);
    f.main.layoutManager.primaryMonitor.inFullscreen = true;
    assert.equal(f.manager._canRevealWithTouch(), true);
    f.settings.set('touch-sensitive-fullscreen-window', false);
    assert.equal(f.manager._canRevealWithTouch(), false);
    f.main.layoutManager.primaryMonitor.inFullscreen = false;
    f.setMain('modalCount', 1);
    assert.equal(f.manager._canRevealWithTouch(), false);
    f.setMain('modalCount', 0);
    f.main.overview.visible = true;
    assert.equal(f.manager._canRevealWithTouch(), false);
    f.main.overview.visible = false;
    f.setMain('actionMode', 2);
    assert.equal(f.manager._canRevealWithTouch(), false);
    f.setMain('actionMode', 1);
    f.settings.set('touch-sensitive', false);
    assert.equal(f.manager._canRevealWithTouch(), false);
});

test('repeated menu checks attach a single close observer', async () => {
    const f = await fixture();
    let connected = 0;
    f.main.panel.menuManager.activeMenu = {
        isOpen: true,
        connect() { connected++; return 1; },
    };
    f.manager._handleMenus();
    f.manager._handleMenus();
    assert.equal(connected, 1);
});
