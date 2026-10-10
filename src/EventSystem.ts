type Callback<T1, T2> = (param1: T1, param2: T2, data?: unknown) => void;

export type InputEvent =
    | { eventType: 'keydown'; code: string; key: string }
    | { eventType: 'keyup'; code: string; key: string }
    | { eventType: 'mousemove'; coord: { x: number; y: number }; button: number }
    | { eventType: 'mousedown'; coord: { x: number; y: number }; button: number }
    | { eventType: 'mouseup'; coord: { x: number; y: number }; button: number }
    | { eventType: 'resize'; width: number; height: number; dpr: number };

export type KeyBoardEventData = Extract<InputEvent, { eventType: 'keydown' | 'keyup' }>;
export type MouseEventData = Extract<InputEvent, { eventType: 'mousemove' | 'mousedown' | 'mouseup' }>;
export type ResizeEvent = Extract<InputEvent, { eventType: 'resize' }>;
export type ResizeEventData = ResizeEvent;

interface ChannelArgs {
    keydown:   KeyBoardEventData;
    keyup:     KeyBoardEventData;
    mousemove: MouseEventData;
    mousedown: MouseEventData;
    mouseup:   MouseEventData;
    resize:    ResizeEventData;
}

type ChannelName = keyof ChannelArgs;

type EventData = InputEvent

interface Listener<T> {
    callback: (param1: T, param2: string, data?: unknown) => void;
    data?: unknown;
}

class Event<K extends ChannelName> {
    private _listeners: Listener<ChannelArgs[K]>[] = [];

    public subscribe(callback: Callback<ChannelArgs[K], string>, data?: unknown) : void {
        this._listeners.push({
            callback,
            data
        })
    }

    public unsubscribe(callback: Callback<ChannelArgs[K], string>) : void {
        const index = this._listeners.findIndex((listener) => listener.callback === callback)
        if (index > -1) {
        	this._listeners.splice(index, 1);
        }
    }

    public emit(data: ChannelArgs[K], param: string) : void  {
        this._listeners.forEach((listener) => listener.callback(data, param, listener.data));
    }

    public emitRaw(data: ChannelArgs[K], param: string): void {
        this.emit(data, param);
    }
}

export default class EventSystem {

    public constructor() {
    }

    public add(data : EventData) {
        switch (data.eventType) {
            case 'keydown':
                this._queue.push(() => this._events.keydown.emit(data, ""));
                return;
            case 'keyup':
                this._queue.push(() => this._events.keyup.emit(data, ""));
                return;
            case 'mousemove':
                this._queue.push(() => this._events.mousemove.emit(data, ""));
                return;
            case 'mousedown':
                this._queue.push(() => this._events.mousedown.emit(data, ""));
                return;
            case 'mouseup':
                this._queue.push(() => this._events.mouseup.emit(data, ""));
                return;
            case 'resize':
                this._queueResize(data);
                return;
        }
    }

    public emit() {
        const queue = this._queue;
        this._queue = [];

        for (const run of queue) {
            try { run(); }
            catch (e) { console.error('[EventSystem]', e); }
        }
    }

    public addEventListener<K extends ChannelName>(type: K, callback: Callback<ChannelArgs[K], string>) {
        this._events[type].subscribe(callback);
    }

    public removeEventListener<K extends ChannelName>(type: K, callback: Callback<ChannelArgs[K], string>) {
        this._events[type].unsubscribe(callback);
    }

    private _events: { [K in ChannelName]: Event<K> } = {
        keydown: new Event<'keydown'>(),
        keyup: new Event<'keyup'>(),
        mousemove: new Event<'mousemove'>(),
        mousedown: new Event<'mousedown'>(),
        mouseup: new Event<'mouseup'>(),
        resize: new Event<'resize'>(),
    };
    private _queue: Array<() => void> = [];
    private _pendingResize: ResizeEventData | null = null;
    private _resizeQueued = false;

    private _queueResize(data: ResizeEventData): void {
        this._pendingResize = data;
        if (this._resizeQueued) return;

        this._resizeQueued = true;
        this._queue.push(() => {
            const latestResize = this._pendingResize;
            this._pendingResize = null;
            this._resizeQueued = false;
            if (latestResize) this._events.resize.emitRaw(latestResize, "");
        });
    }
}