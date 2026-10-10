struct Sphere {
    radius: f32,
    // _pad0: f32,
    // _pad1: f32,
    // _pad2: f32,
}

struct Plane {
    normal: vec3<f32>,
    // _pad0: f32,
};

struct Mesh {
    vertex_start: u32,
    index_start: u32,
    index_count: u32,
    vertex_count: u32,
    BVH_start_ind: u32
};

struct Vertex {
    position: vec4<f32>,
    normal: vec4<f32>,
    uv: vec4<f32>,
    color: vec4<f32>,
};

const SPHERE : u32 = 0u;
const PLANE : u32 = 1u;
const MESH : u32 = 2u;