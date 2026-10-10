import CameraController from "./CameraController";
import EventSystem from "./EventSystem";
import { LOADED_OBJECT } from "./Parser";
import Render from "./Render/Render"
import { createDefaultScene, Scene } from "./Scene";
import { tickFps } from "./fps_counter"

export default class App {
    renderLoopRunning = false;
    frameIndex: number = 0;

    scenes: Array<Scene> = [];
    actualScene: Scene | null = null;

    eventSystem: EventSystem;
    cameraController: CameraController | null = null;

    render: Render | null = null;
    onObjectLoaded: (() => void) | null = null;
    private lastFrameTime = 0;

    constructor() {
        this.eventSystem = new EventSystem();
        this.eventSystem.addEventListener('resize', ({ width, height, dpr }) => {
            this.render?.resize(width, height, dpr);
        });
    }

    async init(width: number, height: number, _canvas: OffscreenCanvas) {
        this.render = new Render();
        await this.render.init(width, height, _canvas);

        this.actualScene = createDefaultScene();
        this.render.updateScene(this.actualScene);
        this.cameraController = new CameraController(this.actualScene.actualCamera, this.eventSystem);
        this.lastFrameTime = performance.now();
        requestAnimationFrame(this.renderFrame.bind(this));
    }

    async renderFrame() {
        if (!this.render || !this.actualScene)
            throw new Error("render is null")

        this.eventSystem.emit();
        if (LOADED_OBJECT.flag) {
            LOADED_OBJECT.flag = false;
            this.render.updateScene(this.actualScene, true);
            this.onObjectLoaded?.();
        }

        const now = performance.now();
        const deltaSeconds = Math.min((now - this.lastFrameTime) / 1000, 0.05);
        this.lastFrameTime = now;
        if (this.cameraController?.update(deltaSeconds) ) {
            this.render.updateCamera();
            this.resetAccumulation();
        }

        await this.render.renderFrame();
        this.frameIndex++;
        tickFps();
        requestAnimationFrame(this.renderFrame.bind(this));
    }

    resetAccumulation() {
        this.frameIndex = 0;
        this.render?.resetAccumulation();
    }
}