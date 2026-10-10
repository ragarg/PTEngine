import type Mesh from "./MeshData";
import type { Vertex } from "./MeshData";
import { vec3 } from "gl-matrix";

export interface Triangle{
    v0: Vertex,
    v1: Vertex,
    v2: Vertex,
    centroid: vec3
}

export class AABB {
    min: vec3 = vec3.fromValues(Infinity, Infinity, Infinity);
    max: vec3 = vec3.fromValues(-Infinity, -Infinity, -Infinity);

    grow(p: vec3): void {
        vec3.min(this.min, p, this.min);
        vec3.max(this.max, p, this.max);
    }
    area(): number {
        const e = vec3.sub(vec3.create(), this.max, this.min);
        return e[0] * e[1] + e[1] * e[2] + e[2] * e[0]; 
    }
}

export interface BVHNode {
    boundingBox: AABB,
    leftChild: number,
    rightChild: number,
    firstTriangleInd: number,
    triangleCount: number,
}

function getTriangle(mesh: Mesh, ind: number) : Triangle {
    const v0 = mesh.vertices[mesh.indices[ind * 3]];
    const v1 = mesh.vertices[mesh.indices[ind * 3 + 1]];
    const v2 = mesh.vertices[mesh.indices[ind * 3 + 2]];

    const centroid = vec3.create();

    vec3.add(centroid, v2.position, vec3.add(centroid, v0.position, v1.position));
    vec3.scale(centroid, centroid, 0.3333);
    return {
        v0,
        v1,
        v2,
        centroid
    }
}

export default class BVH {
    mesh: Mesh;

    constructor(mesh: Mesh) {
        this.mesh = mesh;
        
        for (let i = 0; i < mesh.length; i++) {
            this.trianglesInds.push(i);
        }

        this.BVHNodes[this.rootNodeInd] = {
            boundingBox: new AABB,
            leftChild: -1,
            rightChild: -1,
            firstTriangleInd: 0,
            triangleCount: mesh.length
        }

        this.udpateNodeBounds(this.rootNodeInd);
        this.subdivide(this.rootNodeInd);
    }

    udpateNodeBounds(nodeInd: number): void {
        const node = this.BVHNodes[nodeInd];
        vec3.set(node.boundingBox.min, Infinity, Infinity, Infinity);
        vec3.set(node.boundingBox.max, -Infinity, -Infinity, -Infinity);
        for(let first = node.firstTriangleInd, i = 0; i < node.triangleCount; i++) {
            const leafTri = getTriangle(this.mesh, this.trianglesInds[first + i]);
            vec3.min(node.boundingBox.min, node.boundingBox.min, leafTri.v0.position);
            vec3.min(node.boundingBox.min, node.boundingBox.min, leafTri.v1.position);
            vec3.min(node.boundingBox.min, node.boundingBox.min, leafTri.v2.position);
            vec3.max(node.boundingBox.max, node.boundingBox.max, leafTri.v0.position);
            vec3.max(node.boundingBox.max, node.boundingBox.max, leafTri.v1.position);
            vec3.max(node.boundingBox.max, node.boundingBox.max, leafTri.v2.position);
        }
    }

    evaluateSAH(node: BVHNode, axis: number, pos: number) {
        // determine triangle counts and bounds for this split candidate
        const leftBox = new AABB(), rightBox = new AABB();
        let leftCount = 0, rightCount = 0;
        for(let i = 0; i < node.triangleCount; i++)
        {
            const tri = getTriangle(this.mesh, this.trianglesInds[node.firstTriangleInd + i])
            if (tri.centroid[axis] < pos)
            {
                leftCount++;
                leftBox.grow(tri.v0.position);
                leftBox.grow(tri.v1.position);
                leftBox.grow(tri.v2.position);
            }
            else
            {
                rightCount++;
                rightBox.grow(tri.v0.position);
                rightBox.grow(tri.v1.position);
                rightBox.grow(tri.v2.position);
            }
        }
        const cost = leftCount * leftBox.area() + rightCount * rightBox.area();
        return cost > 0 ? cost : Infinity;
    }

    split(node: BVHNode): {axis: number, splitPos: number, bestCost: number} {
        let bestAxis = -1;
        let bestPos = 0, bestCost = Infinity;
        for(let axis = 0; axis < 3; axis++) {
            for(let i = 0; i < node.triangleCount; i++) {
                const tri = getTriangle(this.mesh, this.trianglesInds[node.firstTriangleInd + i])
                const candidatePos = tri.centroid[axis];
                const cost = this.evaluateSAH(node, axis, candidatePos );
                if (cost < bestCost) {
                    bestPos = candidatePos;
                    bestAxis = axis;
                    bestCost = cost;
                }
            }
        }

        return { axis : bestAxis, splitPos: bestPos, bestCost };
    }

    subdivide(nodeInd: number): void {
        const node = this.BVHNodes[nodeInd];

        const parentArea = node.boundingBox.area();
        const parentCost = node.triangleCount * parentArea;

        const { axis, splitPos, bestCost } = this.split(node);

        if (bestCost >= parentCost ) return;

        let i = node.firstTriangleInd;
        let j = i + node.triangleCount - 1;

        while(i < j) {
            const tri = getTriangle(this.mesh, this.trianglesInds[i]);
            if (tri.centroid[axis] < splitPos) {
                i++;
            }
            else {
                const tri = this.trianglesInds[i];
                this.trianglesInds[i] = this.trianglesInds[j];
                this.trianglesInds[j] = tri;
                j--;
            }
        }

        const leftCount = i - node.firstTriangleInd;
        if (leftCount == 0 || leftCount == node.triangleCount) return;

        const leftChildInd = this.nodesUsed++;
        const rightChildInd = this.nodesUsed++;

        node.leftChild = leftChildInd;
        node.rightChild = rightChildInd;

        this.BVHNodes[leftChildInd] = {
            firstTriangleInd: node.firstTriangleInd,
            triangleCount: leftCount,
            leftChild: -1,
            rightChild: -1,
            boundingBox: new AABB,
        }
        this.BVHNodes[rightChildInd] = {
            firstTriangleInd: i,
            triangleCount: node.triangleCount - leftCount,
            leftChild: -1,
            rightChild: -1,
            boundingBox: new AABB,
        }
        node.triangleCount = 0;
        node.firstTriangleInd = -1;

        this.udpateNodeBounds(leftChildInd);
        this.udpateNodeBounds(rightChildInd);

        this.subdivide(leftChildInd);
        this.subdivide(rightChildInd);
    }

    get size(): number { 
        let size = 0;
        this.BVHNodes.forEach((node: BVHNode) => {
            size += 9 + node.triangleCount;
        });

        return size;
    }

    BVHNodes: BVHNode[] = [];
    rootNodeInd: number = 0;
    nodesUsed: number = 1;
    trianglesInds: number[] = [];
}