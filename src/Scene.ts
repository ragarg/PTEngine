import { type UUID } from "crypto";
import Camera from "./Camera";
import { DEFAUT_MATERIAL, Material } from "./Material";
import { createCube, createPlane, createSphere, Object } from "./Object";
import { loadModel } from "./Parser";
import { vec3 } from "gl-matrix";
import type Mesh from "./MeshData";
import type Image from "./Image";


export interface EmissiveObjectRef {
    primitiveType: number;
    objectIndex: number;
}

export class Scene {
    public objects: Array<Object> = [];
    public materials: Array<Material> = [];
    public meshes: Array<Mesh> = [];
    public images: Array<Image> = [];
    public emissiveObjects: Array<EmissiveObjectRef> = [];

    public actualCamera: Camera;

    public uuid: UUID;

    public constructor(){
        this.uuid = crypto.randomUUID();
        this.addMaterial(DEFAUT_MATERIAL);

        this.actualCamera = new Camera(vec3.fromValues(5.0, 0.0, 5.0), vec3.fromValues(-1.0, 0.0, 1.0));
    }

    addObject(object: Object) {
        this.objects.push(object);

        if (object.material.isEmission()) this.emissiveObjects.push({
            primitiveType: object.primitiveType,
            objectIndex: this.objects.length - 1,
        });
    }

    addMaterial(material: Material) {
        this.materials.push(material);
    }

    updateCamera(position: Float32Array, direction: Float32Array) {
        if (!this.actualCamera)
            return;
        this.actualCamera.position = position;
        this.actualCamera.direction = direction;
    }
}

export function createDefaultScene() : Scene{
    const scene = new Scene();
    scene.actualCamera = new Camera(vec3.fromValues(0.0, 0.0, 0.0), vec3.fromValues(0.0, 0.0, 1.0));

    const planeMaterial = new Material({
        albedo: vec3.fromValues(0.1, 1.0, 0.2),
        roughness: 1.0
    });
    scene.addMaterial(planeMaterial);
    const plane1 = createPlane(vec3.fromValues(0.0, 6.0, 0.0), vec3.fromValues(0.0, 1.0, 0.0), planeMaterial);
    scene.addObject(plane1);
    const plane2 = createPlane(vec3.fromValues(9.0, 0.0, 0.0), vec3.fromValues(1.0, 0.0, 0.0), planeMaterial);
    scene.addObject(plane2);
    const plane3 = createPlane(vec3.fromValues(-5.0, 0.0, 0.0), vec3.fromValues(-1.0, 0.0, 0.0), planeMaterial);
    scene.addObject(plane3);

    const planeMaterial2 = new Material({
        albedo: vec3.fromValues(0.1, 1.0, 0.8),
        roughness: 0.0,
        metallic: 1.0,
    });
    scene.addMaterial(planeMaterial2);
    const plane4 = createPlane(vec3.fromValues(0.0, 0.0, 15.0), vec3.fromValues(0.0, 0.0, 1.0), planeMaterial2);
    scene.addObject(plane4);
    const plane5 = createPlane(vec3.fromValues(0.0, 0.0, -4.0), vec3.fromValues(0.0, 0.0, 1.0), planeMaterial);
    scene.addObject(plane5);
    
    const sphereMaterial1 = new Material({
        albedo: vec3.fromValues(1.0, 0.4, 0.7),
        roughness: 0.2,
        metallic: 1.0,
        // roughnessX: 0.8,
        // roughnessY: 0.1
    });
    scene.addMaterial(sphereMaterial1);
    const sphere1 = createSphere(1, vec3.fromValues(-2.2, 1.0, 13.0), sphereMaterial1);
    scene.addObject(sphere1);

    const sphereMaterial2 = new Material({
        albedo: vec3.fromValues(0.9, 0.9, 0.9),
        roughness: 0.5,
        metallic: 0.0
    });
    scene.addMaterial(sphereMaterial2);
    const sphere2 = createSphere(1.5, vec3.fromValues(3.0, 3.0, 8.0), sphereMaterial2);
    scene.addObject(sphere2);

    const sphereMaterial3 = new Material({
        albedo: vec3.fromValues(0.0, 0.0, 0.0),
        emission: vec3.fromValues(10.0, 10.0, 10.0),
        roughness: 0.05,
        metallic: 0.0
    });
    scene.addMaterial(sphereMaterial3);
    const sphere3 = createSphere(1, vec3.fromValues(0.0, 3.0, 8.0), sphereMaterial3);
    scene.addObject(sphere3);
    // scene.createSphere(0.5, vec3.fromValues(-4.0, -1.0, 14.0), 4);
    // scene.createSphere(0.5, vec3.fromValues(-4.5, 5.0, 14.0), 4);

    const planeMaterial3 = new Material({
        albedo: vec3.fromValues(0.8, 1.0, 0.8),
        roughness: 1.0
    });
    const plane6 = createPlane(vec3.fromValues(0.0, -2.0, 0.0), vec3.fromValues(0.0, -1.0, 0.0), planeMaterial3);
    scene.addObject(plane6);
    const planeMaterial4 = new Material({
        albedo: vec3.fromValues(1.0, 1.0, 1.0),
        roughness: 0.3,
        transmission: 1.0,
        ior: 1.5
    });
    scene.addMaterial(planeMaterial4);
    // scene.createPlane(vec3.fromValues(0.0, 0.0, 10.0), vec3.fromValues(0.0, 0.0, -1.0), 6);

    const sphereMaterial4 = new Material({
        albedo: vec3.fromValues(0.9, 0.9, 0.9),
        roughness: 0.0,
        metallic: 0.0,
        transmission: 1.0,
        ior: 1.5
    });
    scene.addMaterial(sphereMaterial4);
    const sphere4 =  createSphere(1.0, vec3.fromValues(2.0, 0.0, 6.0), sphereMaterial4);
    scene.addObject(sphere4);

    // const mesh = createCube(0.5, sphereMaterial4);
    // scene.addObject(mesh);
    // const mesh2 = createCube(1, sphereMaterial4);
    // scene.addObject(mesh2);

    
    // loadModel(scene, 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb');
    // loadModel(scene, 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb');
    // loadModel(scene, 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/DiffuseTransmissionPlant/glTF-Binary/DiffuseTransmissionPlant.glb');
    // loadModel(scene, 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/BoxTextured/glTF/BoxTextured.gltf');
    return scene;
}
