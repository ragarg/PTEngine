import { type UUID } from "crypto";
import Mesh, { createCubeMesh } from "./MeshData";
import { DEFAUT_MATERIAL, Material } from "./Material";
import { Sphere } from "./primitives/Sphere";
import { Plane } from "./primitives/Plane";
import { mat4, quat, vec3 } from "gl-matrix";

type Primitive =
    | Plane
    | Sphere
    | Mesh;

export const TYPE_SPHERE = 0;
export const TYPE_PLANE = 1;
export const TYPE_MESH = 2;

const TypeNames = ["Sphere", "Plane", "Mesh"];

export interface ObjectData {
    id: number;
    translation: vec3;
    scale: vec3;
    primitiveType: number;
    name: string;
    UUID: UUID
    materialName: string;
    materialUUID: UUID;
    materialIndex: number;
}

export class Object {
    public primitiveType: number;
    public material: Material;
    public primitive : Primitive | null;

    public translation: vec3;
    public rotation: quat;
    public scale: vec3;
    public transform: mat4;

    public name: string;
    public UUID: UUID

    public constructor(opts: Partial<Object> = {}, primitive: Primitive) {
        this.transform = mat4.fromValues(
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        );
        this.translation = opts.translation ?? vec3.create();
        this.rotation = opts.rotation ?? quat.create();
        this.scale = opts.scale ?? vec3.fromValues(1, 1, 1);
        this.primitiveType = opts.primitiveType ?? 0;
        this.material = opts.material ?? DEFAUT_MATERIAL;
        this.primitive = primitive;

        this.name = opts.name ?? TypeNames[this.primitiveType];

        this.UUID = crypto.randomUUID();
    }

    public setTranslation(translation: vec3) {
        this.translation = translation;
    }

    public setScale(scale: vec3) {
        this.scale = scale;
    }

    public setRotation(rotation: quat) {
        this.rotation = rotation;
    }
}

export function createMeshObject(mesh: Mesh, material: Material) {
    const object = new Object({
        primitiveType: TYPE_MESH,
        material
    }, mesh);
    
    return object;
}

export function createCube(size: number, material: Material) {
    const object = new Object({
        primitiveType: TYPE_MESH,
        material
    }, createCubeMesh(size));
    
    return object;
}

export function createSphere(radius: number, pos: vec3, material: Material) : Object {
    const object = new Object({
        translation: pos,
        primitiveType: TYPE_SPHERE,
        material
    }, new Sphere({
        radius
    }));

    return object;
}

export function createPlane(pos: vec3, normal: vec3, material: Material) : Object {
    const object = new Object({
        translation: pos,
        primitiveType: TYPE_PLANE,
        material
    }, new Plane({
        normal
    }));

    return object;
}
