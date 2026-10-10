import { vec3 } from "gl-matrix";
import type Camera from "./Camera";
import type { KeyBoardEventData, MouseEventData } from "./EventSystem";
import type EventSystem from "./EventSystem";

export default class CameraController {
    private readonly _camera: Camera;
    private readonly _keys = new Set<string>();
    private _yaw: number;
    private _pitch: number;
    private _dragging = false;
    private _lastPointer = { x: 0, y: 0 };
    private readonly _onKeyDown = (event: KeyBoardEventData) => {
        this._keys.add(event.code);
    };
    private readonly _onKeyUp = (event: KeyBoardEventData) => {
        this._keys.delete(event.code);
    };
    private readonly _onMouseDown = (event: MouseEventData) => {
        if (event.button !== 0) return;
        this._dragging = true;
        this._lastPointer = { ...event.coord };
    };
    private readonly _onMouseMove = (event: MouseEventData) => {
        if (!this._dragging) return;

        const dx = event.coord.x - this._lastPointer.x;
        const dy = event.coord.y - this._lastPointer.y;
        this._lastPointer = { ...event.coord };
        this._yaw -= dx * 0.005;
        this._pitch = Math.min(Math.max(this._pitch - dy * 0.003, -1.2), 1.2);
        this._updateDirection();
        this._cameraChanged = true;
    };
    private readonly _onMouseUp = () => {
        this._dragging = false;
    };
    private _cameraChanged = false;

    constructor(camera: Camera, eventSystem: EventSystem) {
        this._camera = camera;
        const direction = vec3.normalize(vec3.create(), camera.direction);
        this._yaw = Math.atan2(direction[0], direction[2]);
        this._pitch = Math.asin(Math.min(Math.max(direction[1], -1), 1));
        this._updateDirection();

        eventSystem.addEventListener('keydown', this._onKeyDown);
        eventSystem.addEventListener('keyup', this._onKeyUp);
        eventSystem.addEventListener('mousemove', this._onMouseMove);
        eventSystem.addEventListener('mousedown', this._onMouseDown);
        eventSystem.addEventListener('mouseup', this._onMouseUp);
    }

    public update(deltaSeconds: number): boolean {
        const movement = vec3.fromValues(0, 0, 0);

        if (this._keys.has('KeyW') || this._keys.has('ArrowUp')) movement[2] += 1;
        if (this._keys.has('KeyS') || this._keys.has('ArrowDown')) movement[2] -= 1;
        if (this._keys.has('KeyD') || this._keys.has('ArrowRight')) movement[0] += 1;
        if (this._keys.has('KeyA') || this._keys.has('ArrowLeft')) movement[0] -= 1;
        if (this._keys.has('KeyE') || this._keys.has('Space')) movement[1] += 1;
        if (this._keys.has('KeyQ')) movement[1] -= 1;

        if (vec3.squaredLength(movement) > 0) {
            vec3.normalize(movement, movement);

            const speed = 4.2 * deltaSeconds;
            const right = vec3.fromValues(Math.cos(this._yaw), 0, -Math.sin(this._yaw));
            const forward = this._getForward();
            const up = vec3.fromValues(0, 1, 0);

            vec3.scaleAndAdd(this._camera.position, this._camera.position, right, movement[0] * speed);
            vec3.scaleAndAdd(this._camera.position, this._camera.position, up, movement[1] * speed);
            vec3.scaleAndAdd(this._camera.position, this._camera.position, forward, movement[2] * speed);
            this._cameraChanged = true;
        }

        if (!this._cameraChanged) return false;
        this._cameraChanged = false;
        return true;
    }

    private _getForward(): vec3 {
        return vec3.normalize(
            vec3.create(),
            vec3.fromValues(
                Math.sin(this._yaw) * Math.cos(this._pitch),
                Math.sin(this._pitch),
                Math.cos(this._yaw) * Math.cos(this._pitch),
            ),
        );
    }

    private _updateDirection(): void {
        vec3.copy(this._camera.direction, this._getForward());
    }
}