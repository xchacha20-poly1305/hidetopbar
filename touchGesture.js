import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {EDGE_WIDTH, isAtTopEdge, isDownwardSwipe, REVEAL_DISTANCE} from './touchState.js';

export class TouchRevealGesture {
    constructor(getMonitor, canReveal, onReveal, onTouch, cursorTracker) {
        this._getMonitor = getMonitor;
        this._canReveal = canReveal;
        this._onReveal = onReveal;
        this._cursorTracker = cursorTracker;
        this._contacts = new Set();
        this._edgeContacts = new Set();
        this._candidate = null;
        this._syncId = 0;
        this._edgeActor = new Clutter.Actor({
            name: 'hide-top-bar-touch-edge',
            reactive: false,
            visible: true,
        });
        this._edgeActor.connect('touch-event', (_actor, event) => this._handleEdgeTouch(event));
        Main.layoutManager.addChrome(this._edgeActor, {
            affectsStruts: false,
            trackFullscreen: false,
        });

        // Observe releases even if a Shell menu or overview takes input away.
        // This filter never consumes or cancels client events.
        this._eventId = Clutter.Event.add_filter(null, event => {
            const type = event.type();
            if (type !== Clutter.EventType.TOUCH_BEGIN
                && type !== Clutter.EventType.TOUCH_END
                && type !== Clutter.EventType.TOUCH_CANCEL)
                return Clutter.EVENT_PROPAGATE;
            const slot = event.get_event_sequence().get_slot();
            if (type === Clutter.EventType.TOUCH_BEGIN) {
                this._contacts.add(slot);
                if (this._contacts.size > 1)
                    this._candidate = null;
            } else {
                this._contacts.delete(slot);
                if (this._edgeContacts.delete(slot))
                    this._queueSync();
                if (this._candidate?.slot === slot)
                    this._candidate = null;
            }
            onTouch(event);
            return Clutter.EVENT_PROPAGATE;
        });
        this._visibilityId = cursorTracker.connect('visibility-changed', () => this.sync());
        this.sync();
    }

    sync() {
        const monitor = this._getMonitor();
        if (!monitor) {
            this._edgeActor.hide();
            return;
        }
        this._edgeActor.set_position(monitor.x, monitor.y);
        this._edgeActor.set_size(monitor.width, EDGE_WIDTH);
        // Keep the original actor mapped for the entire touch sequence.
        // The touch starts here, so no application receives a partial sequence.
        this._edgeActor.visible = true;
        this._edgeActor.reactive = this._edgeContacts.size > 0
            || (this._canReveal() && !this._cursorTracker.get_pointer_visible());
    }

    _handleEdgeTouch(event) {
        const type = event.type();
        const slot = event.get_event_sequence().get_slot();
        const [x, y] = event.get_coords();
        if (type === Clutter.EventType.TOUCH_BEGIN) {
            this._edgeContacts.add(slot);
            if (this._contacts.size === 1 && this._canReveal()
                && isAtTopEdge(x, y, this._getMonitor()))
                this._candidate = {slot, x, y};
        } else if (type === Clutter.EventType.TOUCH_UPDATE) {
            const start = this._candidate;
            if (start?.slot === slot) {
                if (!this._canReveal() || this._contacts.size !== 1) {
                    this._candidate = null;
                } else if (isDownwardSwipe(start.x, start.y, x, y)) {
                    this._candidate = null;
                    this._onReveal(slot);
                } else if (Math.abs(x - start.x) >= REVEAL_DISTANCE
                    || y < start.y) {
                    this._candidate = null;
                }
            }
        } else {
            this._edgeContacts.delete(slot);
            this._candidate = null;
        }
        // A touch beginning in the reserved edge stays here through release.
        // There is no stage grab and no mid-sequence cancellation of clients.
        return Clutter.EVENT_STOP;
    }

    refresh() {
        this._queueSync();
    }

    _queueSync() {
        if (this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this.sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    cancel() {
        this._candidate = null;
        this.sync();
    }

    destroy() {
        if (this._syncId)
            GLib.source_remove(this._syncId);
        Clutter.Event.remove_filter(this._eventId);
        this._cursorTracker.disconnect(this._visibilityId);
        Main.layoutManager.removeChrome(this._edgeActor);
        this._edgeActor.destroy();
        this._contacts.clear();
        this._edgeContacts.clear();
    }
}
