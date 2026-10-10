import { type UUID } from "crypto";
import { vec3 } from "gl-matrix";
import Image from "./Image";

export class Material {
    public albedo: vec3;
    public metallic: number;
    public roughness: number;
    public roughnessX: number;
    public roughnessY: number;
    public emission: vec3;
    public ior: number;
    public transmission: number;

    public albedoImage: Image | null;

    public name: string;
    public UUID: UUID

    public constructor(opts: Partial<Material> = {}) {
        this.albedo = opts.albedo ?? vec3.fromValues(0.8, 0.8, 0.8);
        this.emission = opts.emission ?? vec3.fromValues(0.0, 0.0, 0.0);
        this.roughness = opts.roughness ?? 0.5;
        this.roughnessX = opts.roughnessX ?? this.roughness;
        this.roughnessY = opts.roughnessY ?? this.roughness;
        this.metallic = opts.metallic ?? 0.0;
        this.ior = opts.ior ?? 1.3;
        this.transmission = opts.transmission ?? 0.0;

        this.albedoImage = opts.albedoImage ?? null;

        this.name = opts.name ?? "Material";
        this.UUID = crypto.randomUUID();
    }

    public isEmission(): boolean {
        return (
            this.emission[0] > 0.0 ||
            this.emission[1] > 0.0 ||
            this.emission[2] > 0.0
        );
    }
}

export const DEFAUT_MATERIAL = new Material({
    albedo: vec3.fromValues(0.8, 0.8, 0.8),
    metallic: 0.0,
    roughness: 0.5,

    name: "DefaultMaterial"
});
