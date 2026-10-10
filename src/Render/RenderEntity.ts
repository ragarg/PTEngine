import Shader from './Shader';
import {type dataShader, type dataPTShader} from './ShaderSystem';
import type Render from './Render';
import type { GpuData, GpuSceneData } from '../Pack';
import type { PBRTextures } from './Render';



export default class RenderEntity {
    shader : Shader;
    bindGroups : Array<GPUBindGroup> = [];

    sceneBuffers: dataShader;
    pbrTextures : PBRTextures;
    pbrTExtureSampler : GPUSampler;
    data: GpuData;

    constructor(device: GPUDevice, shader: Shader, sceneBuffers: dataShader, pbrTextures: PBRTextures, data: GpuData) {
        this.shader = shader;
        this.sceneBuffers = sceneBuffers;
        this.pbrTextures = pbrTextures;
        this.data = data;

        this.pbrTExtureSampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            addressModeW: 'repeat',
        });
    }

    writeUniform(device: GPUDevice) {
        const data = this.data as GpuSceneData;
        device.queue.writeBuffer(this.sceneBuffers.cameraBuffer, 0, data.cameraData);
    }
}

export function createPTRenderEntity(render: Render, bufferData : dataPTShader, pbrTextures: PBRTextures, data: GpuData) : RenderEntity | null {
    if (!render.device || !render.shaderSystem)
        return null;
    
    const shader = render.shaderSystem.createPTShader(render.device)

    const renderEntity = new RenderEntity(render.device, shader, bufferData, pbrTextures, data);

    renderEntity.bindGroups.push(
        render.device.createBindGroup({
            layout: shader.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: bufferData.outputTexture.createView() },
                { binding: 1, resource: { buffer: bufferData.frameBuffer } },
                { binding: 2, resource: { buffer: bufferData.cameraBuffer } },
            ],
    }));

    renderEntity.bindGroups.push(
        render.device.createBindGroup({
            layout: shader.pipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: bufferData.objectsBuffer } },
                { binding: 1, resource: { buffer: bufferData.primitiveBuffer } },
                { binding: 2, resource: { buffer: bufferData.materialBuffer } },
                { binding: 3, resource: { buffer: bufferData.emissiveObjectBuffer } },
                { binding: 4, resource: { buffer: bufferData.accumBuffer } },
                { binding: 5, resource: { buffer: bufferData.verticesBuffer } },
                { binding: 6, resource: { buffer: bufferData.indicesBuffer } },
                { binding: 7, resource: { buffer: bufferData.bvhBuffer } },
            ],
    }));

    renderEntity.bindGroups.push(
        render.device.createBindGroup({
            layout: shader.pipeline.getBindGroupLayout(2),
            entries: [
                { binding: 0, resource: renderEntity.pbrTextures.albedo.texture.createView({ dimension: '2d-array' }) },
                { binding: 1, resource: renderEntity.pbrTExtureSampler },
            ],
    }));

    return renderEntity;
}