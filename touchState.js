// Distances are in stage coordinates (logical pixels on Wayland).
export const EDGE_WIDTH = 8;
export const REVEAL_DISTANCE = 32;

export function isAtTopEdge(x, y, monitor) {
    return monitor != null
        && x >= monitor.x && x < monitor.x + monitor.width
        && y >= monitor.y && y < monitor.y + EDGE_WIDTH;
}

export function isDownwardSwipe(startX, startY, x, y) {
    const dy = y - startY;
    return dy >= REVEAL_DISTANCE && dy > Math.abs(x - startX);
}

// Keep this independent of Shell so timer and contact ordering can be tested.
export class TouchHold {
    constructor(schedule, cancel, getDelay, onExpired) {
        this._schedule = schedule;
        this._cancel = cancel;
        this._getDelay = getDelay;
        this._onExpired = onExpired;
        this._contacts = new Set();
        this._timer = 0;
        this.active = false;
        this._menuOpen = false;
    }

    reveal(contact) {
        this.active = true;
        this.press(contact);
    }

    press(contact) {
        if (!this.active)
            return;
        this._contacts.add(contact);
        this._stopTimer();
    }

    release(contact) {
        if (this._contacts.delete(contact))
            this.refresh();
    }

    setMenuOpen(open) {
        if (this._menuOpen === open)
            return;
        this._menuOpen = open;
        this.refresh();
    }

    refresh() {
        this._stopTimer();
        if (!this.active || this._contacts.size || this._menuOpen)
            return;
        this._timer = this._schedule(this._getDelay(), () => {
            this._timer = 0;
            this.active = false;
            this._onExpired();
        });
    }

    _stopTimer() {
        if (this._timer)
            this._cancel(this._timer);
        this._timer = 0;
    }

    reset() {
        this._stopTimer();
        this.active = false;
        this._contacts.clear();
        this._menuOpen = false;
    }
}
