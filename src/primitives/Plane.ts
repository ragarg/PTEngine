import { vec3 } from "gl-matrix";

export class Plane {
    public normal: vec3;

    constructor(opts: Partial<Plane> = {}) {
        this.normal = opts.normal ?? vec3.fromValues(0.0, 0.0, 1.0);
    }
}