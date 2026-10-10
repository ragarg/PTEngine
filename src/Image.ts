import { type UUID } from "crypto";

export interface ImageData {
    data: ArrayBuffer,
    width: number,
    height: number,
}

export default class Image {
    imageData: ImageData;
    mimeType: string;
    name: string;
    // sourceImage
    
    UUID: UUID;

    constructor(name: string, data: ImageData, mimeType: string) {
        this.name = name;
        this.imageData = data;
        this.mimeType = mimeType;

        this.UUID = crypto.randomUUID();
    }
}