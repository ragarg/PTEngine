
// export class Texture() {
//     texture;
// }

import type Image from "../Image";

export class TextureArrayWrapper {
    public texture: GPUTexture;
    public width: number;
    public height: number;
    public size: number;

    public constructor(device: GPUDevice, width: number, height: number, size?: number ) {
        this.width = width;
        this.height = height;
        this.size = size ?? 1;
        this.texture = device.createTexture({
            size: [this.width, this.height, this.size],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            dimension: '2d',
        });
    }

    public clear() {
        this.size = 0;
    }

    public add(device: GPUDevice, image: Image) {
        device.queue.writeTexture(
            { texture:this.texture, origin: [0, 0, this.size] },
            image.imageData.data,
            { bytesPerRow: this.width * 4, rowsPerImage: this.height },
            [this.width, this.height, 1],
        );
    }

    // private _lastIndex: number = 0;
}