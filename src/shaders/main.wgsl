struct FrameParams {
    frame : u32,
    width : u32,
    height : u32,
    _pad : u32,
    emissive_count : u32,
    render_mode : u32,
}

struct Camera {
    pos: vec3<f32>,
    dir: vec3<f32>,
}

@group(0) @binding(0) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<uniform> frame : FrameParams;
@group(0) @binding(2) var<uniform> camera : Camera;

@group(1) @binding(0) var <storage,read> objects_buf: array<Object>;
@group(1) @binding(1) var <storage,read> primitive_buf: array<u32>;
@group(1) @binding(2) var <storage,read> materials_buf: array<Material>;
@group(1) @binding(3) var <storage,read> emissive_objects_buf: array<EmissiveObject>;
@group(1) @binding(4) var <storage,read_write> accum_buf : array<vec4f>;

@group(1) @binding(5) var<storage,read> vertices_buf: array<Vertex>;
@group(1) @binding(6) var<storage,read> indices_buf: array<u32>;

@group(2) @binding(0) var texture_array_albedo : texture_2d_array<f32>;
@group(2) @binding(1) var texture_sampler_pbr: sampler;

/*
num_nodes(Object->BVH_start_ind)
"first node"
AABB_min_x
AABB_min_y
AABB_min_z
AABB_max_x
AABB_max_y
AABB_max_z
num_triangles
offset to ind_left_child(0 if num_triangles > 0)
offset to ind_rigth_child(0 if num_triangles > 0)
tri_ind_0
tri_ind_1
...
tri_ind_num_triangles
"next node"
AABB_min_x
...
"end BVH/Start next BVH"
*/
@group(1) @binding(7) var<storage,read> bvh_buf: array<f32>;

#include "common/object.wgsl"
#include "common/material.wgsl"
#include "common/integrator.wgsl"

const DOF_FOCUS_DISTANCE: f32 = 5.0;
const DOF_APERTURE_RADIUS: f32 = 0.2;

@compute @workgroup_size(16, 8)

fn main(@builtin(global_invocation_id) gid: vec3u) {
    if (gid.x >= frame.width || gid.y >= frame.height) {
        return;
    }

    let coords = vec2i(gid.xy);
    let dims = vec2f(textureDimensions(outputTex));

    var sample = vec3f(0.0);
    let forward = normalize(camera.dir);
    let world_up = vec3f(0.0, 1.0, 0.0);
    let up_ref = select(world_up, vec3f(0.0, 0.0, 1.0), abs(dot(forward, world_up)) > 0.999);

    let right = normalize(cross(up_ref, forward));
    let up    = cross(forward, right);

    var rng = pcg_hash(gid.x ^ (gid.y * 1973u) ^ (frame.frame * 9277u));
    let jitter_x = random01(&rng) - 0.5;
    let jitter_y = random01(&rng) - 0.5;
    var dir_x = f32(coords.x) - dims.x/2.;
    var dir_y = f32(-coords.y) + dims.y/2.;
    let dir_z = dims.x/(2.*tan(1.5/2.));
    if (frame.render_mode != 0u) {
        dir_x = dir_x + jitter_x;
        dir_y = dir_y + jitter_y;
    }

    let world_dir = normalize(
        dir_x * right +
        dir_y * up +
        dir_z * forward
    );
    var rayOrigin = camera.pos;
    var rayDirection = world_dir;
    if (frame.render_mode != 0u) {
        let focusDistanceAlongRay = DOF_FOCUS_DISTANCE / dot(world_dir, forward);
        let focusPoint = camera.pos + world_dir * focusDistanceAlongRay;

        let angle = random01(&rng) * 6.28318530718;
        let radius = sqrt(random01(&rng)) * DOF_APERTURE_RADIUS;
        let disk = vec2f(cos(angle), sin(angle)) * radius;
        rayOrigin += disk.x * right + disk.y * up;
        rayDirection = normalize(focusPoint - rayOrigin);
    }
    let ray = Ray(rayOrigin, rayDirection);

    if (frame.render_mode == 0u) {
        sample += albedo(ray);
    } else {
        sample += tracePath(ray, 6, &rng);
    }

    var avg = vec3f(0.0);
    let idx = gid.y * frame.width + gid.x;
    if (frame.frame > 0) {
        let prev = accum_buf[idx].rgb;
        let sum = prev + sample;
        accum_buf[idx] = vec4f(sum, 1.0);

        avg = sum / f32(frame.frame + 1u);
    }
    else {
        accum_buf[idx] = vec4f(sample, 1.0);
        avg = sample;
    }
    

    if (frame.render_mode == 0u) {
        textureStore(outputTex, coords, vec4f(sample, 1.0));
    }
    else {
        textureStore(outputTex, coords, vec4f(avg, 1.0));
    }
}