/**
 * This file is part of Hide Top Bar
 *
 * Copyright 2020 Thomas Vogt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as PanelVisibilityManager from './panelVisibilityManager.js';
import * as Convenience from './convenience.js';
const DEBUG = Convenience.DEBUG;

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

let mSettings = null;
let mPVManager = null;
let monitorIndex = null;
let mSeat = null;
let mTouchModeId = 0;
let mKeepVisibleId = 0;

function getDefaultSeat() {
    // Clutter.get_default_backend() is gone in GNOME 51,
    // Clutter.Stage.get_context() only exists since GNOME 47.
    if (typeof global.stage.get_context === 'function')
        return global.stage.get_context().get_backend().get_default_seat();
    return Clutter.get_default_backend().get_default_seat();
}

function restoreStrut() {
    // destroy() can leave the panel without a strut (it does while the screen
    // is locked), and when starting in touch mode there is no manager that
    // would give it back.
    const panelBox = Main.layoutManager.panelBox;
    Main.layoutManager.removeChrome(panelBox);
    Main.layoutManager.addChrome(panelBox, {
        affectsStruts: true,
        trackFullscreen: true,
    });
}

function syncManager() {
    // In touch mode (tablet without a keyboard) there is no pointer to
    // reveal the panel, so optionally behave like stock GNOME.
    const suspend = mSettings.get_boolean('keep-visible-in-touch-mode') &&
        mSeat.touch_mode;
    if (suspend && mPVManager) {
        DEBUG("syncManager(): touch mode, panel kept visible");
        mPVManager.destroy();
        mPVManager = null;
    } else if (!suspend && !mPVManager) {
        monitorIndex = Main.layoutManager.primaryIndex;
        DEBUG("syncManager(): no touch mode, panel managed");
        mPVManager = new PanelVisibilityManager.PanelVisibilityManager(
            mSettings, monitorIndex,
        );
    }
}

export default class HideTopBarExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        console.log(`Initiating ${this.uuid}`);
    }

    enable() {
        DEBUG("enable()");
        mSettings = this.getSettings();
        mSeat = getDefaultSeat();
        mTouchModeId = mSeat.connect('notify::touch-mode', syncManager);
        mKeepVisibleId = mSettings.connect(
            'changed::keep-visible-in-touch-mode', syncManager,
        );
        syncManager();
        if (!mPVManager)
            restoreStrut();
    }

    disable() {
        DEBUG("disable()");
        mSeat.disconnect(mTouchModeId);
        mSettings.disconnect(mKeepVisibleId);
        if (mPVManager)
            mPVManager.destroy();

        mPVManager = null;
        mSeat = null;
        mTouchModeId = 0;
        mKeepVisibleId = 0;
        mSettings = null;
    }
}
