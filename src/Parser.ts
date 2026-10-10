import { GltfLoader, type GltfAsset } from 'gltf-loader-ts';
import Mesh, { type Vertex } from './MeshData';
import type { Scene } from './Scene';
import { DEFAUT_MATERIAL, Material } from './Material';
import { createMeshObject } from './Object';
import { mat4, vec3 } from 'gl-matrix';
import Image, { type ImageData } from './Image';

// Keep the exported binding mutable for compatibility with existing consumers.
// eslint-disable-next-line prefer-const
export let LOADED_OBJECT = { flag : false};

export interface ParsedScene {
  meshes: Mesh[];
  materials: Material[];
  textures: Image[];
  // явный маппинг: meshIndex → materialIndex
  meshMaterialPairs: Array<{ meshIndex: number; materialIndex: number }>;
}

// ---------- Таблицы glTF ----------

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

interface AccessorData {
  array: number[];
  count: number;
  components: number;
  componentType: number;
  normalized: boolean;
}

interface GltfNodeTransform {
  children?: number[];
  matrix?: number[];
  mesh?: number;
  rotation?: number[];
  scale?: number[];
  translation?: number[];
}

// ---------- Accessors ----------

function readComponent(view: DataView, offset: number, componentType: number): number {
  switch (componentType) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default: throw new Error(`Unsupported glTF accessor component type ${componentType}.`);
  }
}

function normalizeComponent(value: number, componentType: number): number {
  switch (componentType) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32767, -1);
    case 5123: return value / 65535;
    default: return value;
  }
}

function readAccessorElement(
  view: DataView,
  byteLength: number,
  byteOffset: number,
  componentType: number,
  components: number,
  normalized: boolean,
): number[] {
  const componentBytes = COMPONENT_BYTES[componentType];
  const values = new Array<number>(components);

  for (let i = 0; i < components; i++) {
    const offset = byteOffset + i * componentBytes;
    if (offset < 0 || offset + componentBytes > byteLength) {
      throw new Error('glTF accessor element extends beyond its bufferView.');
    }
    const value = readComponent(view, offset, componentType);
    values[i] = normalized ? normalizeComponent(value, componentType) : value;
  }

  return values;
}

async function loadAccessor(
  asset: GltfAsset,
  accessorIdx: number,
): Promise<AccessorData | null> {
  const acc = asset.gltf.accessors?.[accessorIdx];
  if (!acc) return null;

  const componentBytes = COMPONENT_BYTES[acc.componentType];
  const components = TYPE_COMPONENTS[acc.type];
  if (!componentBytes || !components) {
    throw new Error(`Accessor ${accessorIdx} has an unsupported component or element type.`);
  }
  if (!Number.isInteger(acc.count) || acc.count < 0) {
    throw new Error(`Accessor ${accessorIdx} has an invalid element count.`);
  }

  const array = new Array<number>(acc.count * components).fill(0);
  const elementBytes = componentBytes * components;

  if (acc.bufferView != null) {
    const bufferView = asset.gltf.bufferViews?.[acc.bufferView];
    if (!bufferView) {
      throw new Error(`Accessor ${accessorIdx} references missing bufferView ${acc.bufferView}.`);
    }
    const data = await asset.bufferViewData(acc.bufferView);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const byteOffset = acc.byteOffset ?? 0;
    const stride = bufferView.byteStride ?? elementBytes;
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || stride < elementBytes) {
      throw new Error(`Accessor ${accessorIdx} has an invalid byte offset or stride.`);
    }

    for (let i = 0; i < acc.count; i++) {
      const values = readAccessorElement(
        view,
        data.byteLength,
        byteOffset + i * stride,
        acc.componentType,
        components,
        acc.normalized ?? false,
      );
      for (let component = 0; component < components; component++) {
        array[i * components + component] = values[component];
      }
    }
  }

  if (acc.sparse) {
    const sparse = acc.sparse;
    if (!Number.isInteger(sparse.count) || sparse.count < 0 || sparse.count > acc.count) {
      throw new Error(`Accessor ${accessorIdx} has an invalid sparse element count.`);
    }
    const indexBytes = COMPONENT_BYTES[sparse.indices.componentType];
    if (![5121, 5123, 5125].includes(sparse.indices.componentType) || !indexBytes) {
      throw new Error(`Accessor ${accessorIdx} has an invalid sparse index component type.`);
    }
    const indexData = await asset.bufferViewData(sparse.indices.bufferView);
    const sparseValuesData = await asset.bufferViewData(sparse.values.bufferView);
    const indexView = new DataView(indexData.buffer, indexData.byteOffset, indexData.byteLength);
    const sparseValuesView = new DataView(
      sparseValuesData.buffer,
      sparseValuesData.byteOffset,
      sparseValuesData.byteLength,
    );
    const indicesOffset = sparse.indices.byteOffset ?? 0;
    const valuesOffset = sparse.values.byteOffset ?? 0;
    let previousIndex = -1;

    for (let i = 0; i < sparse.count; i++) {
      const indexValues = readAccessorElement(
        indexView,
        indexData.byteLength,
        indicesOffset + i * indexBytes,
        sparse.indices.componentType,
        1,
        false,
      );
      const elementIndex = indexValues[0];
      if (elementIndex <= previousIndex || elementIndex >= acc.count) {
        throw new Error(`Accessor ${accessorIdx} has an out-of-range or unordered sparse index.`);
      }
      previousIndex = elementIndex;

      const values = readAccessorElement(
        sparseValuesView,
        sparseValuesData.byteLength,
        valuesOffset + i * elementBytes,
        acc.componentType,
        components,
        acc.normalized ?? false,
      );
      for (let component = 0; component < components; component++) {
        array[elementIndex * components + component] = values[component];
      }
    }
  }

  return {
    array,
    count: acc.count,
    components,
    componentType: acc.componentType,
    normalized: acc.normalized ?? false,
  };
}

function nodeTransform(node: GltfNodeTransform): mat4 {
  if (node.matrix) {
    if (node.matrix.length !== 16) {
      throw new Error('glTF node matrix must contain 16 values.');
    }
    return node.matrix;
  }

  const translation = node.translation ?? [0, 0, 0];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const scale = node.scale ?? [1, 1, 1];
  if (translation.length !== 3 || rotation.length !== 4 || scale.length !== 3) {
    throw new Error('glTF node has invalid TRS dimensions.');
  }

  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  const [tx, ty, tz] = translation;
  return mat4.fromValues(
    (1 - 2 * (y * y + z * z)) * sx,
    (2 * (x * y + z * w)) * sx,
    (2 * (x * z - y * w)) * sx,
    0,
    (2 * (x * y - z * w)) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    (2 * (y * z + x * w)) * sy,
    0,
    (2 * (x * z + y * w)) * sz,
    (2 * (y * z - x * w)) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx, ty, tz, 1,
  );
}

function collectMeshInstances(
  asset: GltfAsset,
  meshPrimitiveIndices: number[][],
): Array<{ meshIndex: number; transform: mat4 }> {
  const nodes: GltfNodeTransform[] = asset.gltf.nodes ?? [];
  if (nodes.length === 0) {
    return meshPrimitiveIndices.flatMap((primitiveIndices) =>
      primitiveIndices.map((meshIndex) => ({ meshIndex, transform: mat4.identity(mat4.create()) }))
    );
  }

  const scenes = asset.gltf.scenes ?? [];
  const activeScene = scenes[asset.gltf.scene ?? 0];
  const childNodes = new Set<number>();
  for (const node of nodes) {
    for (const child of node.children ?? []) childNodes.add(child);
  }
  const roots = activeScene?.nodes ?? nodes
    .map((_node, index) => index)
    .filter((index) => !childNodes.has(index));
  const instances: Array<{ meshIndex: number; transform: mat4, name: string }> = [];

  const visit = (
    nodeIndex: number,
    parentTransform: mat4,
    ancestry: Set<number>,
  ): void => {
    const node = nodes[nodeIndex];
    if (!node) throw new Error(`glTF scene references missing node ${nodeIndex}.`);
    if (ancestry.has(nodeIndex)) {
      throw new Error(`glTF node hierarchy contains a cycle at node ${nodeIndex}.`);
    }

    const worldTransform = mat4.mul(mat4.create(), parentTransform, nodeTransform(node));
    if (node.mesh != null) {
      const primitives = meshPrimitiveIndices[node.mesh];
      if (!primitives) throw new Error(`glTF node references missing mesh ${node.mesh}.`);
      for (const meshIndex of primitives) {
        instances.push({ meshIndex, transform: worldTransform, name: `node_${nodeIndex}` });
      }
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(nodeIndex);
    for (const child of node.children ?? []) {
      visit(child, worldTransform, nextAncestry);
    }
  };

  for (const root of roots) visit(root, mat4.identity(mat4.create()), new Set());
  return instances;
}

// ---------- Текстуры ----------

async function loadTextures(asset: GltfAsset): Promise<Image[]> {
  const textures: Image[] = [];
  const images = asset.gltf.images ?? [];

  // для каждого image нужны сырые байты. Пробуем два пути:
  //  1) image.bufferView — данные в GLB-контейнере
  //  2) image.uri — внешний файл или data-URL
  const imageBytes: Array<{ data: ImageData; mime: string } | null> = [];

  for (const img of images) {
    let data: ImageData | null = null;
    let mime = img.mimeType ?? 'image/png';

    if (img.bufferView != null) {
      const imageView = await asset.bufferViewData(img.bufferView);
      const imageCopy = new Uint8Array(imageView.byteLength);

      const decodeTexture = async (data: ArrayBuffer, mimeType: string) => {
        const blob = new Blob([data], { type: mimeType });
        const bitmap = await createImageBitmap(blob);

        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);

        const width = bitmap.width;
        const height = bitmap.height;

        const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        bitmap.close(); // освобождаем ресурс

        return {
          data: imageData.data.buffer,
          width,
          height,
        };
      }

      // const decodeTexture = async (data: ArrayBuffer, mimeType: string) => {
      //   const decoder = new ImageDecoder({
      //     data,
      //     type: mimeType,
      //   });
      //   const result = await decoder.decode();
      //   const { data: pixels, width, height } = result.image;
      //   decoder.close();

      //   return { data: (new Uint8Array(pixels)).buffer, width, height };
      // }
      imageCopy.set(imageView);
      data = await  decodeTexture(imageCopy.buffer, mime)
    } else if (img.uri?.startsWith('data:')) {
      // data-URL — декодируем base64
      const comma = img.uri.indexOf(',');
      const meta = img.uri.slice(5, comma); // до запятой, напр. "image/png;base64"
      mime = meta.split(';')[0];
      const b64 = img.uri.slice(comma + 1);
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length); 
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      data = { data: buf.buffer, width: 0, height: 0 };
    } else if (img.uri) {
      // внешний файл — gltf-loader-ts его уже скачал, но сырых байтов
      // у нас нет. Придётся скачать ещё раз.
      try {
        const res = await fetch(new URL(img.uri, asset.gltf.uri ?? '').href);
        data = { data: await res.arrayBuffer(), width: 0, height: 0 };
        mime = res.headers.get('content-type') ?? mime;
      } catch {
        console.warn(`[gltf] не удалось загрузить image.uri=${img.uri}`);
      }
    }

    imageBytes.push(data ? { data, mime } : null);
  }

  for (let i = 0; i < (asset.gltf.textures?.length ?? 0); i++) {
    const tex = asset.gltf.textures![i];
    const sourceIdx = tex.source ?? -1;
    const imgData = imageBytes[sourceIdx];

    if (!imgData) {
      console.warn(`[gltf] texture ${i}: image ${sourceIdx} недоступен`);
      continue;
    }

    textures.push(
      new Image(tex.name, imgData.data, imgData.mime)
    );
  }

  return textures;
}

// ---------- Материалы ----------

function readMaterial(
  asset: GltfAsset,
  textures: Image[],
  matIdx: number,
): Material {
  const m = asset.gltf.materials![matIdx];
  const pbr = m.pbrMetallicRoughness ?? {};

  const albedo = (pbr.baseColorFactor ?? [1, 1, 1, 1]) as [number, number, number, number];
  const metallic = pbr.metallicFactor ?? 1;
  const roughness = pbr.roughnessFactor ?? 1;
  const emissive = (m.emissiveFactor ?? [0, 0, 0]) as [number, number, number];

  const albedoImage = pbr?.baseColorTexture ? textures[pbr.baseColorTexture.index] : null;
  // extensions
  const ext = m.extensions ?? {};
  const iorExt = ext['KHR_materials_ior'] as { ior?: number } | undefined;
  const transExt = ext['KHR_materials_transmission'] as
    | { transmissionFactor?: number }
    | undefined;

  const ior = iorExt?.ior ?? 1.5;
  const transmission = transExt?.transmissionFactor ?? 0;

  return new Material({
    name : m.name,
    albedo: albedo,
    roughness,
    metallic,
    emission : emissive,
    ior,
    transmission,
    albedoImage
  });
}

// ---------- Меши ----------

const DEFAULT_COLOR = [1, 1, 1, 1];

function readVertex(
  i: number,
  pos: Float32Array,
  nrm: Float32Array | null,
  uv: Float32Array | null,
  col: Float32Array | null,
  colComponents: number,
  colScale: number,
): Vertex {
  const position = [0, 0, 0];
  position[0] = pos[i * 3];
  position[1] = pos[i * 3 + 1];
  position[2] = pos[i * 3 + 2];

  const normal = [0, 0, 0];
  if (nrm) {
    normal[0] = nrm[i * 3];
    normal[1] = nrm[i * 3 + 1];
    normal[2] = nrm[i * 3 + 2];
  }

  const texCoord = [0, 0];
  if (uv) {
    texCoord[0] = uv[i * 2];
    texCoord[1] = uv[i * 2 + 1];
  }

  const color = [...DEFAULT_COLOR];
  if (col) {
    if (colComponents === 4) {
      color[0] = col[i * 4] * colScale;
      color[1] = col[i * 4 + 1] * colScale;
      color[2] = col[i * 4 + 2] * colScale;
      color[3] = col[i * 4 + 3] * colScale;
    } else {
      color[0] = col[i * 3] * colScale;
      color[1] = col[i * 3 + 1] * colScale;
      color[2] = col[i * 3 + 2] * colScale;
      color[3] = 1;
    }
  }

  return { position, normal, uv: texCoord, color };
}

// ---------- Точка входа ----------

export async function parseGltf(asset: GltfAsset): Promise<ParsedScene> {
  const accessorCache = new Map<number, AccessorData | null>();

  const getAccessor = async (idx: number | undefined) => {
    if (idx == null) return null;
    if (!accessorCache.has(idx)) {
      accessorCache.set(idx, await loadAccessor(asset, idx));
    }
    return accessorCache.get(idx)!;
  };

  // 1. Текстуры (грузим первыми — материалы на них ссылаются)
  const textures = await loadTextures(asset);

  // 2. Материалы
  const materials: Material[] = [];
  const matCount = asset.gltf.materials?.length ?? 0;
  for (let i = 0; i < matCount; i++) {
    materials.push(readMaterial(asset, textures, i));
  }

  // 3. Меши
  const meshes: Mesh[] = [];
  const meshMaterialPairs: Array<{ meshIndex: number; materialIndex: number }> = [];
  const meshPrimitiveIndices: number[][] = [];

  const gltfMeshes = asset.gltf.meshes ?? [];

  for (let mi = 0; mi < gltfMeshes.length; mi++) {
    const gltfMesh = gltfMeshes[mi];
    const primitiveIndices: number[] = [];

    for (let pi = 0; pi < gltfMesh.primitives.length; pi++) {
      const prim = gltfMesh.primitives[pi];

      const primitiveMode = prim.mode ?? 4;
      if (primitiveMode !== 4 && primitiveMode !== 5 && primitiveMode !== 6) continue;

      const posAccIdx = prim.attributes['POSITION'];
      if (posAccIdx == null) continue;

      const posAcc = await getAccessor(posAccIdx);
      if (!posAcc) continue;

      const nrmAcc = await getAccessor(prim.attributes['NORMAL']);
      const uvAcc = await getAccessor(prim.attributes['TEXCOORD_0']);
      const colAccIdx = prim.attributes['COLOR_0'];
      const colAcc = await getAccessor(colAccIdx);
      const idxAcc = await getAccessor(prim.indices);

      if (posAcc.components !== 3 || posAcc.componentType !== 5126) {
        throw new Error(`Mesh ${mi} primitive ${pi} POSITION must be a VEC3 float accessor.`);
      }
      if (nrmAcc && (nrmAcc.components !== 3 || nrmAcc.count !== posAcc.count)) {
        throw new Error(`Mesh ${mi} primitive ${pi} NORMAL accessor does not match POSITION.`);
      }
      if (uvAcc && (uvAcc.components !== 2 || uvAcc.count !== posAcc.count)) {
        throw new Error(`Mesh ${mi} primitive ${pi} TEXCOORD_0 accessor does not match POSITION.`);
      }
      if (colAcc && ((colAcc.components !== 3 && colAcc.components !== 4) || colAcc.count !== posAcc.count)) {
        throw new Error(`Mesh ${mi} primitive ${pi} COLOR_0 accessor does not match POSITION.`);
      }

      const positions = Float32Array.from(posAcc.array);
      const normals = nrmAcc ? Float32Array.from(nrmAcc.array) : null;
      const uvs = uvAcc ? Float32Array.from(uvAcc.array) : null;
      const colors = colAcc ? Float32Array.from(colAcc.array) : null;

      const colComponents = colAcc?.components ?? 4;

      const vertices: Vertex[] = new Array(posAcc.count);
      for (let i = 0; i < posAcc.count; i++) {
        vertices[i] = readVertex(
          i,
          positions,
          normals,
          uvs,
          colors,
          colComponents,
          1,
        );
      }

      let indices: number[];
      if (idxAcc) {
        if (idxAcc.components !== 1 || idxAcc.normalized
          || ![5121, 5123, 5125].includes(idxAcc.componentType)) {
          throw new Error(`Mesh ${mi} primitive ${pi} indices must use an unsigned scalar accessor.`);
        }
        indices = idxAcc.array;
      } else {
        indices = vertices.map((_, i) => i);
      }
      if (primitiveMode === 5) {
        const triangleIndices: number[] = [];
        for (let i = 0; i + 2 < indices.length; i++) {
          if (i % 2 === 0) {
            triangleIndices.push(indices[i], indices[i + 1], indices[i + 2]);
          } else {
            triangleIndices.push(indices[i + 1], indices[i], indices[i + 2]);
          }
        }
        indices = triangleIndices;
      } else if (primitiveMode === 6) {
        const triangleIndices: number[] = [];
        for (let i = 1; i + 1 < indices.length; i++) {
          triangleIndices.push(indices[0], indices[i], indices[i + 1]);
        }
        indices = triangleIndices;
      }
      if (indices.length % 3 !== 0) {
        throw new Error(`Mesh ${mi} primitive ${pi} has an index count not divisible by three.`);
      }
      for (const index of indices) {
        if (!Number.isInteger(index) || index < 0 || index >= vertices.length) {
          throw new Error(`Mesh ${mi} primitive ${pi} contains out-of-range index ${index}.`);
        }
      }

      const meshIndex = meshes.length;
      const materialIndex = prim.material ?? -1;
      if (materialIndex >= materials.length) {
        throw new Error(`Mesh ${mi} primitive ${pi} references missing material ${materialIndex}.`);
      }

      meshes.push(new Mesh(vertices, indices));
      meshMaterialPairs.push({ meshIndex, materialIndex });
      primitiveIndices.push(meshIndex);
    }
    meshPrimitiveIndices.push(primitiveIndices);
  }

  const parsedScene = {
    meshes,
    materials,
    textures,
    meshMaterialPairs,
    meshInstances: collectMeshInstances(asset, meshPrimitiveIndices),
  };
  return parsedScene;
}

export async function loadModel(scene: Scene, path: string) {
    const loader = new GltfLoader();
    const asset = await loader.load(path);

    const sceneGltf = await parseGltf(asset);
    const meshInstances = (sceneGltf as ParsedScene & {
      meshInstances: Array<{ meshIndex: number; transform: Float32Array }>;
    }).meshInstances;

    sceneGltf.textures.forEach((t: Image) => {
      scene.images.push(t);
    })
    
    sceneGltf.materials.forEach((mat: Material) => {
        scene.addMaterial(mat);
    });
    meshInstances.forEach(({ meshIndex, transform }) => {
        const mesh = sceneGltf.meshes[meshIndex];
        const materialIndex = sceneGltf.meshMaterialPairs[meshIndex].materialIndex;
        const material = materialIndex < 0
          ? DEFAUT_MATERIAL
          : sceneGltf.materials[materialIndex];
        const obj = createMeshObject(mesh, material);
        const translation = mat4.getTranslation(vec3.create(), transform);
        const scale = mat4.getScaling(vec3.create(), transform);
        obj.setTranslation(translation);
        obj.setScale(scale);
        scene.addObject(obj);
    });

    LOADED_OBJECT.flag = true;
}

// Пример вызова
// loadModel('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DiffuseTransmissionPlant/glTF-Binary/DiffuseTransmissionPlant.glb');