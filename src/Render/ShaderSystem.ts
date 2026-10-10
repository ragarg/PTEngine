
import Shader from "./Shader"
import shaderCode from '../shaders/main.wgsl?raw'

const PT_SHADER = 0;

export interface dataPTShader {
    outputTexture: GPUTexture,
    frameBuffer: GPUBuffer,

    cameraBuffer: GPUBuffer,

    objectsBuffer: GPUBuffer,
    primitiveBuffer: GPUBuffer,
    materialBuffer: GPUBuffer,
    emissiveObjectBuffer: GPUBuffer,
    accumBuffer: GPUBuffer,
    verticesBuffer: GPUBuffer,
    indicesBuffer: GPUBuffer,
    bvhBuffer: GPUBuffer,
}

export type dataShader = 
    | dataPTShader

export default class ShaderSystem {
    shaders: Map<number, Shader> = new Map;

    createPTShader(device : GPUDevice) : Shader {
        let shader = this.shaders.get(PT_SHADER);
        if (!shader) {
            
            shader = new Shader(device, shaderCode);
            this.shaders.set(PT_SHADER, shader);
        }

        return shader;
    }
}
