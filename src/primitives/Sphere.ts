export class Sphere {
    public radius: number;

    constructor(opts: Partial<Sphere> = {}) {
        this.radius = opts.radius ?? 0;
    }
}

