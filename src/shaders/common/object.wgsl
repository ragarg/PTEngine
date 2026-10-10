#include "primitives/primitives.wgsl"

struct Object {
    transform : mat4x4<f32>,
    invTransform : mat4x4<f32>,
    ind : vec2<u32>,
    primitive_type : u32,
    mat_ind : u32,
}

struct EmissiveObject {
    primitive_type : u32,
    object_ind : u32,
}

fn sphereFrom(object: Object) -> Sphere {
    let radius = bitcast<f32>(primitive_buf[object.ind.x * 5]);
    return Sphere(radius);
}

fn planeFrom(object: Object) -> Plane {
    let x = bitcast<f32>(primitive_buf[object.ind.x * 5]);
    let y = bitcast<f32>(primitive_buf[object.ind.x * 5 + 1]);
    let z = bitcast<f32>(primitive_buf[object.ind.x * 5 + 2]);
    let normal = vec3f(x, y, z);
    return Plane(normal);
}

fn meshFrom(object: Object) -> Mesh {
    return Mesh(
        primitive_buf[object.ind.x * 5],
        primitive_buf[object.ind.x * 5 + 1],
        primitive_buf[object.ind.x * 5 + 2],
        primitive_buf[object.ind.x * 5 + 3],
        primitive_buf[object.ind.x * 5 + 4]);
}

// fn planeFrom(object: Object) {

// }