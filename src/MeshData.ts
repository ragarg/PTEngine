import { vec2, vec3, vec4 } from "gl-matrix";
import BVH from "./BVH";

export interface Vertex {
    position: vec3;
    normal: vec3;
    uv: vec2;
    color: vec4;
}

export default class Mesh {
    vertices: Vertex[] = [];
    indices: number[] = [];

    bvh: BVH;

    constructor(vertices: Vertex[], indices: number[]){
        this.vertices = vertices;
        this.indices = indices;

        this.bvh = new BVH(this);
    }

    get length() {
        return this.indices.length / 3;
    }
}

export function createCubeMesh(size = 1): Mesh {
    const h = size / 2;
    const vertices: Vertex[] = [];
    const indices: number[] = [];


    const faces: {
        normal: vec3;
        right: vec3;
        up: vec3;
    }[] = [
        // +X
        { normal: [ 1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
        // -X
        { normal: [-1, 0, 0], right: [0, 0,  1], up: [0, 1, 0] },
        // +Y
        { normal: [0,  1, 0], right: [1, 0, 0],  up: [0, 0, -1] },
        // -Y
        { normal: [0, -1, 0], right: [1, 0, 0],  up: [0, 0,  1] },
        // +Z
        { normal: [0, 0,  1], right: [1, 0, 0],  up: [0, 1, 0] },
        // -Z
        { normal: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
    ];

    for (const face of faces) {
        const [nx, ny, nz] = face.normal;
        const [rx, ry, rz] = face.right;
        const [ux, uy, uz] = face.up;

        const base = vertices.length;

        const corners: [number, number][] = [
        [-1, -1],
        [ 1, -1],
        [ 1,  1],
        [-1,  1],
        ];

        for (const [cu, cv] of corners) {
            const px = (nx + rx * cu + ux * cv) * h;
            const py = (ny + ry * cu + uy * cv) * h;
            const pz = (nz + rz * cu + uz * cv) * h;

            // UV: [-1..1] -> [0..1]
            const u = (cu + 1) * 0.5;
            const v = (cv + 1) * 0.5;

            vertices.push({
                position: vec3.fromValues(px, py, pz),
                normal:   vec3.fromValues(nx, ny, nz),
                uv:       vec2.fromValues(u, v),
                color:    vec4.fromValues(0, 0, 0, 0),
            });
        }

        indices.push(
            base + 0, base + 1, base + 2,
            base + 0, base + 2, base + 3,
        );
    }

    return new Mesh(vertices, indices);
}