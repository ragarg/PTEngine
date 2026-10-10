import type { vec3 } from "gl-matrix";


export default class Camera {
    position: vec3;
    direction: vec3;

    constructor(position: vec3, direction: vec3) {
        this.position = position;
        this.direction = direction;
    }
}