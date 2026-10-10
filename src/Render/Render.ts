import { MATERIAL_STRIDE_BYTES, OBJECT_STRIDE_BYTES, PRIMITIVE_STRIDE_BYTES, type GpuSceneData } from '../Pack';
import { Scene } from '../Scene';
import ShaderSystem from './ShaderSystem';

import { scenePack } from '../Pack';
import type { UUID } from 'crypto';
import RenderEntity, { createPTRenderEntity } from './RenderEntity';
import { TextureArrayWrapper } from './Texture';
import type Image from '../Image';

export interface SceneData {
    objectsBuffer: GPUBuffer;
    primitiveBuffer: GPUBuffer;
    emissiveObjectBuffer: GPUBuffer;
    materialBuffer: GPUBuffer;
    verticesBuffer: GPUBuffer;
    indicesBuffer: GPUBuffer;
    bvhBuffer: GPUBuffer;

    cameraBuffer: GPUBuffer;
}

export interface PBRTextures {
    albedo: TextureArrayWrapper;
}

export default class Render {
    device: GPUDevice | null = null;
    shaderSystem: ShaderSystem | null = null;

    outputTexture: GPUTexture | null = null;
    private canvasContext: GPUCanvasContext | null = null;
    frameBuffer: GPUBuffer | null = null;
    accumBuffer: GPUBuffer | null = null;

    sceneBuffers: SceneData | null = null;
    pbrTextures : PBRTextures | null = null;

    readbackBuffer: GPUBuffer | null = null;
    currentWidth = 0;
    currentHeight = 0;
    currentEmissiveCount = 0;
    currentRenderMode = 0;

    sample: number = 0;
    maxSample: number = 60000;

    renderEntities: Map<UUID, RenderEntity> = new Map();

    constructor() {
    }

    async init(width: number, height: number, _canvas: OffscreenCanvas) {
        await this._initGPU(width, height, _canvas);
    }

    resetAccumulation() {
        if (!this.device || !this.accumBuffer) return;
        
        this.sample = 0;
    }

    resize(width: number, height: number, dpr: number): void {
        if (!this.device || !this.outputTexture || !this.accumBuffer || !this.frameBuffer) {
            throw new Error('Render is not initialized');
        }

        const nextWidth = Math.max(1, Math.floor(width * dpr));
        const nextHeight = Math.max(1, Math.floor(height * dpr));
        if (nextWidth === this.currentWidth && nextHeight === this.currentHeight) return;

        const oldOutputTexture = this.outputTexture;
        const oldAccumBuffer = this.accumBuffer;
        this.currentWidth = nextWidth;
        this.currentHeight = nextHeight;

        if (this.canvasContext) {
            this.canvasContext.canvas.width = nextWidth;
            this.canvasContext.canvas.height = nextHeight;
        }

        this.outputTexture = this.device.createTexture({
            size: [nextWidth, nextHeight],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC,
        });
        this.accumBuffer = this.device.createBuffer({
            size: nextWidth * nextHeight * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        oldOutputTexture.destroy();
        oldAccumBuffer.destroy();

        for (const [sceneId, entity] of this.renderEntities) {
            const updatedEntity = createPTRenderEntity(this,
            {
                outputTexture: this.outputTexture,
                frameBuffer : this.frameBuffer,
                accumBuffer : this.accumBuffer,

                cameraBuffer : entity.sceneBuffers.cameraBuffer,

                objectsBuffer : entity.sceneBuffers.objectsBuffer,
                primitiveBuffer : entity.sceneBuffers.primitiveBuffer,
                materialBuffer : entity.sceneBuffers.materialBuffer,
                emissiveObjectBuffer : entity.sceneBuffers.emissiveObjectBuffer,
                verticesBuffer: entity.sceneBuffers.verticesBuffer,
                indicesBuffer: entity.sceneBuffers.indicesBuffer,
                bvhBuffer: entity.sceneBuffers.bvhBuffer,
            }, entity.pbrTextures, entity.data);

            if (!updatedEntity) {
                throw new Error(`Unable to recreate render entity for scene ${sceneId}`);
            }
            this.renderEntities.set(sceneId, updatedEntity);
        }

        this.resetAccumulation();
    }

    async renderFrame(): Promise<void>  {
        if (!this.device || !this.outputTexture || !this.canvasContext) {
            return;
        }

        if (this.sample > this.maxSample || (this.sample == 1 && this.currentRenderMode == 0))
            return;

        this.writeFrameUniform();

        const encoder = this.device.createCommandEncoder();

        this.renderEntities.forEach(re => {
            re.writeUniform(this.device as GPUDevice);
            this.drawRenderEntity(encoder, re);
        })


        encoder.copyTextureToTexture(
            { texture: this.outputTexture },
            { texture: this.canvasContext.getCurrentTexture() },
            [this.currentWidth, this.currentHeight, 1]
        );

        this.device.queue.submit([encoder.finish()]);
        this.sample++;

        if (this.sample % 100 ==0){
            console.log(this.sample);
        }

        await this.device.queue.onSubmittedWorkDone();
    }

    drawRenderEntity(encoder : GPUCommandEncoder, renderEntity : RenderEntity, ) {
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(renderEntity.shader.pipeline);
        computePass.setBindGroup(0, renderEntity.bindGroups[0]);
        computePass.setBindGroup(1, renderEntity.bindGroups[1]);
        computePass.setBindGroup(2, renderEntity.bindGroups[2]);
        computePass.dispatchWorkgroups(
            Math.ceil(this.currentWidth / 16),
            Math.ceil(this.currentHeight / 8)
        );
        computePass.end();
    }

    writeFrameUniform() {
        if (!this.device || !this.frameBuffer) return;

        const buffer = new ArrayBuffer(16 * 4);
        const f32 = new Float32Array(buffer);
        const u32 = new Uint32Array(buffer);

        u32[0] = this.sample;
        u32[1] = this.currentWidth;
        u32[2] = this.currentHeight;
        u32[3] = 0;
        u32[4] = this.currentEmissiveCount;
        u32[5] = this.currentRenderMode;

        f32.set([-3.0, 0.0, 0.0], 8);
        f32.set([0.0, 0.0, 1.0], 12);
        this.device.queue.writeBuffer(this.frameBuffer, 0, buffer);
    }

    changeMode(mode : number) {
        this.currentRenderMode = mode === 1 ? 1 : 0;
    }

    updateScene(scene: Scene, deep?: boolean) {
        if (!this.device || !this.outputTexture || !this.frameBuffer || !this.accumBuffer) {
            throw Error("device is not initialized")
        }

        this._actualScene = scene;

        const sceneData = scenePack(scene);
        if (!this.sceneBuffers || deep) {
            this.sceneBuffers = this._createSceneBuffers(this.device, scene, sceneData);
        }

        this.device.queue.writeBuffer(this.sceneBuffers.objectsBuffer, 0, sceneData.objects);
        this.device.queue.writeBuffer(this.sceneBuffers.primitiveBuffer, 0, sceneData.primitives);
        this.device.queue.writeBuffer(this.sceneBuffers.materialBuffer, 0, sceneData.materials);
        this.device.queue.writeBuffer(this.sceneBuffers.emissiveObjectBuffer, 0, sceneData.emissiveObjects);
        if (sceneData.vertices.byteLength > 0) {
            this.device.queue.writeBuffer(this.sceneBuffers.verticesBuffer, 0, sceneData.vertices);
        }
        if (sceneData.indices.byteLength > 0) {
            this.device.queue.writeBuffer(this.sceneBuffers.indicesBuffer, 0, sceneData.indices);
        }
        if (sceneData.bvh.byteLength > 0) {
            this.device.queue.writeBuffer(this.sceneBuffers.bvhBuffer, 0, sceneData.bvh);
        }
        
        if (!this.pbrTextures) {
            this.pbrTextures = {
                albedo: new TextureArrayWrapper(this.device, 512, 512)
            }
        }

        this.pbrTextures.albedo.clear();
        scene.images.forEach((img: Image) => {
            (this.pbrTextures as PBRTextures ).albedo.add(this.device as GPUDevice, img);
        });

        let renderEntity = this.renderEntities.get(scene.uuid);
        if (!renderEntity || deep) {
            const createdEntity = createPTRenderEntity(this,
                {
                    outputTexture: this.outputTexture,
                    frameBuffer : this.frameBuffer,
                    accumBuffer : this.accumBuffer,

                    cameraBuffer : this.sceneBuffers.cameraBuffer,

                    objectsBuffer : this.sceneBuffers.objectsBuffer,
                    primitiveBuffer : this.sceneBuffers.primitiveBuffer,
                    materialBuffer : this.sceneBuffers.materialBuffer,
                    emissiveObjectBuffer : this.sceneBuffers.emissiveObjectBuffer,
                    verticesBuffer: this.sceneBuffers.verticesBuffer,
                    indicesBuffer: this.sceneBuffers.indicesBuffer,
                    bvhBuffer: this.sceneBuffers.bvhBuffer,
                },
                this.pbrTextures,
                sceneData,
            )

            if (createdEntity == null)
                throw new Error("RenderEntity is not created");
            renderEntity = createdEntity;
        }



        this.renderEntities.set(scene.uuid, renderEntity);
        this.currentEmissiveCount = scene.emissiveObjects.length;
    }

    updateCamera() {
        this._updateEntityDataByScene();
    }

    private _createSceneBuffers(device: GPUDevice, scene: Scene, sceneData: GpuSceneData) : SceneData{
        const sceneBuffers: SceneData = {
            objectsBuffer: device.createBuffer({
                size: OBJECT_STRIDE_BYTES * scene.objects.length,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
            primitiveBuffer: device.createBuffer({
                size: PRIMITIVE_STRIDE_BYTES * scene.objects.length,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
            materialBuffer: device.createBuffer({
                size: MATERIAL_STRIDE_BYTES * scene.materials.length,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
            emissiveObjectBuffer: device.createBuffer({
                size: Math.max(64, scene.emissiveObjects.length * 8),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
            verticesBuffer: device.createBuffer({
                size: Math.max(64, sceneData.vertices.byteLength),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
            indicesBuffer: device.createBuffer({
                size: Math.max(64, sceneData.indices.byteLength),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
            bvhBuffer: device.createBuffer({
                size: Math.max(64, sceneData.bvh.byteLength),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            }),
            cameraBuffer: device.createBuffer({
                size: 32 * 4 * 2,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }),
        }

        return sceneBuffers;
    }

    private _actualScene: Scene | null = null;

    private async _initGPU(width: number, height: number, _canvas: OffscreenCanvas) {
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance',
        });
        this.shaderSystem = new ShaderSystem();
        if (!adapter || !this.shaderSystem ) throw new Error('No WebGPU adapter');

        console.info('WebGPU adapter:', adapter.info);

        this.device = await adapter.requestDevice();
        this.currentWidth = width;
        this.currentHeight = height;        


        this.canvasContext = _canvas.getContext('webgpu');
        if (!this.canvasContext) {
            throw new Error('Unable to create WebGPU canvas context');
        }
        this.canvasContext.configure({
            device: this.device,
            format: 'rgba8unorm',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            alphaMode: 'opaque',
        });


        this.outputTexture = this.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage:
            GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.COPY_SRC,
        });

        this.accumBuffer = this.device.createBuffer({
            size: width * height * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.frameBuffer = this.device.createBuffer({
            size: 32 * 12 * 10,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        if (!this.canvasContext) {
            const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
            this.readbackBuffer = this.device.createBuffer({
                size: bytesPerRow * height,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
        }

        this.resetAccumulation();
    }

    private _updateEntityDataByScene(): void {
        if (!this._actualScene)
            return;

        const scene = this._actualScene;

        const renderEntity = this.renderEntities.get(scene.uuid);
        
        if (!renderEntity || !scene.actualCamera)
            return;

        renderEntity.data.cameraData = (new Float32Array([
            scene.actualCamera.position[0],
            scene.actualCamera.position[1],
            scene.actualCamera.position[2],
            0.0,
            scene.actualCamera.direction[0],
            scene.actualCamera.direction[1],
            scene.actualCamera.direction[2],
            0.0
        ])).buffer;
    }
}