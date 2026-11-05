import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {PanelVisibilityManager} from './panelVisibilityManager.js';

function sleep(milliseconds) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

function check(value, message) {
    if (!value)
        throw new Error(message);
    console.log(`TOUCH TEST PASS ${message}`);
}

export default class NativeTouchTests extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settings.set_boolean('enable-intellihide', false);
        this._settings.set_boolean('mouse-sensitive', false);
        this._settings.set_double('touch-delay', 1);
        this._manager = new PanelVisibilityManager(this._settings, Main.layoutManager.primaryIndex);
        this._run().then(() => this._finish('PASS')).catch(error => {
            console.error(error);
            this._finish(`FAIL ${error}\n${error.stack}`);
        });
    }

    _finish(result) {
        GLib.file_set_contents(GLib.getenv('HIDETOPBAR_TEST_RESULT'), result);
        global.context.terminate();
    }

    _startClient(mode) {
        GLib.spawn_async(null, ['python3', GLib.getenv('HIDETOPBAR_TEST_CLIENT'), mode],
            null, GLib.SpawnFlags.SEARCH_PATH, null);
    }

    async _run() {
        await sleep(2000);
        Main.overview.hide();
        await sleep(1000);
        const manager = this._manager;
        const background = new Clutter.Actor({reactive: true, width: 1024, height: 768});
        Main.uiGroup.insert_child_at_index(background, 0);
        background.show();
        await sleep(100);

        const seat = global.stage.context.get_backend().get_default_seat();
        const touch = seat.create_virtual_device(Clutter.InputDeviceType.TOUCHSCREEN_DEVICE);
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), 500, 400);
        await sleep(500);
        Main.overview.hide();
        await sleep(1000);

        const down = (slot, x, y) => touch.notify_touch_down(GLib.get_monotonic_time(), slot, x, y);
        const move = (slot, x, y) => touch.notify_touch_motion(GLib.get_monotonic_time(), slot, x, y);
        const up = slot => touch.notify_touch_up(GLib.get_monotonic_time(), slot);
        const swipe = async (startY = 2, endX = 400, endY = 45) => {
            down(0, 400, startY);
            await sleep(80);
            move(0, endX, endY);
            await sleep(300);
            up(0);
            await sleep(100);
        };

        manager.hide(0, 'test-init');
        await sleep(100);
        down(0, 400, 2);
        await sleep(100);
        move(0, 400, 33);
        await sleep(100);
        check(manager._panelHidden, '31px does not reveal');
        move(0, 400, 34);
        await sleep(350);
        check(!manager._panelHidden && manager._touchHold.active, '32px reveals and holds');
        await sleep(1100);
        check(!manager._panelHidden, 'finger down suspends timeout');
        up(0);
        await sleep(150);
        check(manager._touchHold._contacts.size === 0 && manager._touchHold._timer !== 0,
            'release starts timer');
        await sleep(1100);
        check(manager._panelHidden, 'timeout hides with an invisible cursor at the edge');

        await swipe(15, 400, 100);
        check(manager._panelHidden, 'outside edge ignored');
        down(0, 400, 2);
        await sleep(80);
        down(1, 500, 100);
        await sleep(80);
        move(0, 400, 60);
        await sleep(100);
        up(0);
        up(1);
        await sleep(300);
        check(manager._panelHidden, 'multiple fingers do not reveal');
        await swipe(2, 450, 34);
        check(manager._panelHidden, 'horizontal dominant swipe ignored');
        await swipe();
        check(!manager._panelHidden, 'repeat reveal works');
        down(0, 400, 10);
        await sleep(1200);
        check(!manager._panelHidden, 'panel press suspends timer');
        up(0);
        await sleep(1200);
        check(manager._panelHidden, 'panel release restarts timer');

        await swipe();
        const menu = Main.panel.statusArea.dateMenu.menu;
        menu.open();
        await sleep(1200);
        check(!manager._panelHidden && manager._touchHold._timer === 0, 'menu holds panel');
        menu.close();
        await sleep(300);
        check(!manager._panelHidden, 'menu close grants the full delay');
        await sleep(1000);
        check(manager._panelHidden, 'menu close timeout hides');

        background.destroy();
        this._startClient('button');
        await sleep(2000);
        check(global.display.focus_window?.get_title() === 'HideTopBarTestWindow'
            && global.display.focus_window.is_fullscreen(), 'fullscreen client is focused');
        await swipe(2, 400, 100);
        check(!manager._panelHidden && global.display.focus_window.is_fullscreen(),
            'fullscreen reveal keeps the window fullscreen');
        check(!GLib.file_test(GLib.getenv('HIDETOPBAR_CLICK_RESULT'), GLib.FileTest.EXISTS),
            'reveal does not click the client');
        check(Main.panel.menuManager.activeMenu == null, 'reveal does not activate a panel menu');
        await sleep(1200);
        check(manager._panelHidden, 'fullscreen timeout hides');
        const modalGrab = Main.pushModal(global.stage);
        await sleep(100);
        check(!manager._touchGesture._edgeActor.reactive, 'modal disables the touch edge');
        Main.popModal(modalGrab);
        await sleep(100);
        check(manager._touchGesture._edgeActor.reactive, 'closing modal restores the touch edge');
        this._settings.set_boolean('touch-sensitive-fullscreen-window', false);
        await sleep(100);
        await swipe();
        check(manager._panelHidden, 'fullscreen preference blocks reveal');
        this._settings.set_boolean('touch-sensitive', false);
        await sleep(100);
        check(manager._touchGesture === null && !manager._touchHold.active,
            'disabling touch clears the gesture and hold');
        this._settings.set_boolean('touch-sensitive-fullscreen-window', true);
        this._settings.set_boolean('touch-sensitive', true);
        await sleep(100);
        await swipe();
        check(!manager._panelHidden, 'reenabling touch restores reveal');
        await sleep(1200);
        Main.overview.show();
        await sleep(400);
        check(!manager._touchHold.active, 'overview clears touch hold');
        Main.overview.hide();
        await sleep(500);
        await swipe();
        check(!manager._panelHidden, 'reveal works after overview');
        await sleep(1200);

        global.display.focus_window.delete(global.get_current_time());
        this._startClient('drag');
        await sleep(1500);
        const window = global.display.focus_window;
        check(window?.get_title() === 'HideTopBarDragWindow', 'draggable client is focused');
        // Exercise both sides of the boundary that exposed the compositor crash.
        for (let iteration = 0; iteration < 20; iteration++) {
            window.maximize();
            await sleep(120);
            manager._touchHold.reset();
            manager.hide(0, 'drag-test');
            await sleep(50);
            down(0, 400, 2);
            await sleep(50);
            move(0, 400, 100);
            await sleep(100);
            check(!manager._panelHidden && !global.display.is_grabbed(),
                `edge swipe over draggable client ${iteration}`);
            up(0);
            await sleep(70);
            manager._touchHold.reset();
            manager.hide(0, 'drag-test');
            down(0, 400, 20);
            await sleep(50);
            move(0, 440, 160);
            await sleep(150);
            check(global.display.is_grabbed(), `ordinary client touch drag ${iteration}`);
            up(0);
            await sleep(80);
        }
        const edge = manager._touchGesture._edgeActor;
        manager.destroy();
        this._manager = null;
        check(!Main.uiGroup.get_children().includes(edge), 'destroy removes edge chrome');
    }

    disable() {
        this._manager?.destroy();
        this._manager = null;
    }
}
