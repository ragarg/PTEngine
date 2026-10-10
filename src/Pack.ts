import { mat4 } from "gl-matrix";
import type { BVHNode } from "./BVH";
import type BVH from "./BVH";
import type { Material } from "./Material";
import type { Vertex } from "./MeshData";
import type Mesh from "./MeshData";
// import type Mesh from "./MeshData";
import { TYPE_SPHERE, TYPE_PLANE, type Object, TYPE_MESH } from "./Object";
import type { Plane } from "./primitives/Plane";
import type { Sphere } from "./primitives/Sphere";
import { Scene, type EmissiveObjectRef } from "./Scene";

export const OBJECT_STRIDE_BYTES = 144;
export const OBJECT_STRIDE_F32 = 36; // 144 / 4
export const PLANES_STRIDE_F32 = 4;
export const PRIMITIVE_STRIDE_BYTES = 20;
export const PRIMITIVE_STRIDE_U32 = 5;
export const SPHERE_STRIDE_F32 = 4;
export const MATERIAL_STRIDE_BYTES = 16 * 4;
export const MATERIAL_STRIDE_F32 = 16;

export interface GpuObjectSlot {
    /** view длиной 16, куда кладётся матрица */
    transform: Float32Array;
    /** view длиной 16, куда кладётся инвертированная матрица */
    invTransform: Float32Array;
    /** view длиной 2, куда кладутся primitive_type и ind */
    meta: Uint32Array;
}

export interface GpuPlaneSlot {
    normal: Float32Array;
}

export interface GpuSphereSlot {
  data: Float32Array;
}

export interface GpuMaterialSlot {
  albedo: Float32Array; // rgb + metallic
  emission: Float32Array; // rgb + roughness
  params: Float32Array; // ior, transmission, roughnessX, roughnessY
  textures: Uint32Array;
}

export interface GpuSceneData {
    objects: ArrayBuffer;
    primitives: ArrayBuffer;
    materials: ArrayBuffer;
    emissiveObjects: ArrayBuffer;
    cameraData: ArrayBuffer;
    vertices: ArrayBuffer;
    indices: ArrayBuffer;
    bvh: ArrayBuffer;
}

export type GpuData = 
    | GpuSceneData

function concatFloat32(...arrays: Float32Array[]): Float32Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Float32Array(total);

  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }

  return result;
}

function concatUint32(...arrays: Uint32Array[]): Uint32Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint32Array(total);

  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}

export function scenePack(scene: Scene) : GpuSceneData{
    function packPlane(plane: Plane, slot: GpuPlaneSlot): void {
        slot.normal.set(plane.normal);
    }

    function packSphere(sphere: Sphere, slot: GpuSphereSlot): void {
        slot.data[0] = sphere.radius;
    }

    const sizeBCHNode = 9;
    function packBVH(bvh: BVH): Float32Array {
        const bvhBuf = new ArrayBuffer(bvh.size * 4 + 4);
        const bvhBuff32 = new Float32Array(bvhBuf);
        const bvhBufu32 = new Uint32Array(bvhBuf);

        bvhBufu32[0] = bvh.BVHNodes.length;
        
        let ind = 1;
        const inds: number[] = [];
        bvh.BVHNodes.forEach((node: BVHNode, i : number) => {
            inds[i] = ind;
            bvhBuff32[ind] = node.boundingBox.min[0];
            bvhBuff32[ind + 1] = node.boundingBox.min[1];
            bvhBuff32[ind + 2] = node.boundingBox.min[2];
            bvhBuff32[ind + 3] = node.boundingBox.max[0];
            bvhBuff32[ind + 4] = node.boundingBox.max[1];
            bvhBuff32[ind + 5] = node.boundingBox.max[2];
            bvhBufu32[ind + 6] = node.triangleCount;

            ind += sizeBCHNode;
            for (let i = 0; i < node.triangleCount; i++) {
                bvhBufu32[ind + i] = bvh.trianglesInds[node.firstTriangleInd + i];
            }

            ind += node.triangleCount;
        });

        ind = 1;
        bvh.BVHNodes.forEach((node: BVHNode) => {
            bvhBufu32[ind + 7] = inds[node.leftChild];
            bvhBufu32[ind + 8] = inds[node.rightChild];

            ind += sizeBCHNode + node.triangleCount;
        });

        return bvhBuff32;
    }

    function packMesh(mesh: Mesh): { vertices : Float32Array, indices : Uint32Array, bvh : Float32Array } {
        const vertices = new Float32Array(mesh.vertices.length * 16);
        mesh.vertices.forEach((vertex: Vertex, index: number) => {
            if (vertex.position.length < 3 || vertex.normal.length < 3
                || vertex.uv.length < 2 || vertex.color.length < 4) {
                throw new Error(`Mesh vertex ${index} does not contain position, normal, UV, and RGBA color data.`);
            }

            const offset = index * 16;
            vertices.set([vertex.position[0], vertex.position[1], vertex.position[2], 1], offset);
            vertices.set([vertex.normal[0], vertex.normal[1], vertex.normal[2], 0], offset + 4);
            vertices.set([vertex.uv[0], vertex.uv[1], 0, 0], offset + 8);
            vertices.set(vertex.color, offset + 12);
        });

        if (mesh.indices.length % 3 !== 0) {
            mesh.indices.push(0);
            // throw new Error('Mesh index count must be divisible by three.');
        }
        for (const index of mesh.indices) {
            if (!Number.isInteger(index) || index < 0 || index >= mesh.vertices.length) {
                throw new Error(`Mesh index ${index} is outside the vertex array.`);
            }
        }

        return {
            vertices,
            indices: new Uint32Array(mesh.indices),
            bvh: packBVH(mesh.bvh)
        }
    }

    function objectPack(object: Object, privitiveInd: [number, number], slot: GpuObjectSlot): void {
        mat4.fromRotationTranslationScale(object.transform, object.rotation, object.translation, object.scale);
        const invTransform = mat4.create();
        mat4.invert(invTransform, object.transform);
        slot.transform.set(object.transform);
        slot.invTransform.set(invTransform);
        slot.meta[0] = privitiveInd[0];
        slot.meta[1] = privitiveInd[1];
        slot.meta[2] = object.primitiveType;
        slot.meta[3] = materialMap.get(object.material.UUID) ?? 0;
    }

    function packObjects(objects: Object[]): { objects : ArrayBuffer, primitives : ArrayBuffer,  vertices : ArrayBuffer, indices : ArrayBuffer, bvh : ArrayBuffer } {
        const objectsData = new ArrayBuffer(objects.length * OBJECT_STRIDE_BYTES);
        const of32 = new Float32Array(objectsData);
        const ou32 = new Uint32Array(objectsData);

        const primitivesData = new ArrayBuffer(objects.length * PRIMITIVE_STRIDE_BYTES);
        const pf32 = new Float32Array(primitivesData);
        const pu32 = new Uint32Array(primitivesData);

        const verticesArray: Float32Array[] = [];
        const indicesArray: Uint32Array[] = [];
        const bvhArray: Float32Array[] = [];
        let vertexCount = 0;
        let indexCount = 0;
        let bvhCount = 0

        for (let i = 0; i < objects.length; i++) {
            let privitiveInd: [number, number];
            const object = objects[i];
            if (!object.primitive) {
                throw new Error(`Object ${object.UUID} has no primitive data.`);
            }

            const pbase = i * PRIMITIVE_STRIDE_U32;
            switch (object.primitiveType) {
                case TYPE_PLANE:
                    packPlane(object.primitive as Plane, { normal: pf32.subarray(pbase, pbase + 3) });
                    privitiveInd = [i, i];
                    break;
                case TYPE_SPHERE:
                    packSphere(object.primitive as Sphere, { data: pf32.subarray(pbase, pbase + SPHERE_STRIDE_F32) });
                    privitiveInd = [i, i];
                    break;
                case TYPE_MESH: {
                    const mesh = object.primitive as Mesh;
                    const { vertices, indices, bvh } = packMesh(mesh);
                    verticesArray.push(vertices);
                    indicesArray.push(indices);
                    bvhArray.push(bvh);
                    pu32[pbase] = vertexCount;
                    pu32[pbase + 1] = indexCount;
                    pu32[pbase + 2] = indices.length;
                    pu32[pbase + 3] = mesh.vertices.length;
                    pu32[pbase + 4] = bvhCount;
                    vertexCount += mesh.vertices.length;
                    indexCount += indices.length;
                    bvhCount += bvh.length;
                    privitiveInd = [i, i];
                    break;
                }
                default:
                    privitiveInd = [i, i];
                    break;
            }

            const obase = i * OBJECT_STRIDE_F32;
            objectPack(object, privitiveInd,
            {
                transform: of32.subarray(obase, obase + 16),
                invTransform: of32.subarray(obase + 16, obase + 32),
                meta: ou32.subarray(obase + 32, obase + 36),
            });
        }

        const veticesData = concatFloat32(...verticesArray).buffer as ArrayBuffer;
        const indicesData = concatUint32(...indicesArray).buffer as ArrayBuffer;
        const bvhData = concatFloat32(...bvhArray).buffer as ArrayBuffer;
        return {
            primitives: primitivesData,
            objects: objectsData,
            vertices: veticesData,
            indices: indicesData,
            bvh: bvhData
        };
    }

    function packEmissiveObjects(objects: EmissiveObjectRef[]): ArrayBuffer {
        const buffer = new ArrayBuffer(Math.max(8, objects.length * 8));
        const u32 = new Uint32Array(buffer);

        for (let i = 0; i < objects.length; i++) {
            const base = i * 2;
            u32[base] = objects[i].primitiveType;
            u32[base + 1] = objects[i].objectIndex;
        }

        return buffer;
    }

    function packMaterial(material: Material, slot: GpuMaterialSlot): void{
        const a = slot.albedo;
        a[0] = material.albedo[0];
        a[1] = material.albedo[1];
        a[2] = material.albedo[2];
        a[3] = material.metallic;

        const e = slot.emission;
        e[0] = material.emission[0];
        e[1] = material.emission[1];
        e[2] = material.emission[2];
        e[3] = material.roughness;

        const p = slot.params;
        p[0] = material.ior;
        p[1] = material.transmission;
        p[2] = material.roughnessX;
        p[3] = material.roughnessY;

        const t = slot.textures;
        t[0] = material.albedoImage ? imagesMap.get(material.albedoImage.UUID) ?? 0 : 0;
    }

    function packMaterials(materials: Material[]): ArrayBuffer {
        const buffer = new ArrayBuffer(materials.length * MATERIAL_STRIDE_BYTES);
        const f32 = new Float32Array(buffer);
        const u32 = new Uint32Array(buffer);

        for (let i = 0; i < materials.length; i++) {
            const base = i * MATERIAL_STRIDE_F32;
            packMaterial(materials[i],
            {
                albedo: f32.subarray(base, base + 4),
                emission: f32.subarray(base + 4, base + 8),
                params: f32.subarray(base + 8, base + 12),
                textures: u32.subarray(base + 12, base + 16),
            });
        }

        return buffer;
    }

    const materialMap = new Map(scene.materials.map((item, i) => [item.UUID, i]));
    const imagesMap = new Map(scene.images.map((item, i) => [item.UUID, i + 1]));

    const { objects, primitives, vertices, indices, bvh } = packObjects(scene.objects);

    const materials = packMaterials(scene.materials);
    const emissiveObjects = packEmissiveObjects(scene.emissiveObjects);
    const cameraData = (new Float32Array([
        scene.actualCamera.position[0],
        scene.actualCamera.position[1],
        scene.actualCamera.position[2],
        0.0,
        scene.actualCamera.direction[0],
        scene.actualCamera.direction[1],
        scene.actualCamera.direction[2],
        0.0
    ])).buffer;

    return {
        objects,
        primitives,
        materials,
        emissiveObjects,
        cameraData,
        vertices,
        indices,
        bvh
    };
}