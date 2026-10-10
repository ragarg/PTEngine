#include "BVH.wgsl"

const INF : f32 = 1e30;

struct HitInfo {
    material : Material,
    position : vec3<f32>,
    normal : vec3<f32>,
    uv: vec2<f32>,
    intersected: bool,
    time: f32,
}

fn sphereIntersect(sphere : Sphere, transform : mat4x4<f32>, ray : Ray) -> f32 {
    let oc = ray.origin - transform[3].xyz;
    let a = dot(ray.direction, ray.direction);
    let b = 2.0f * dot(oc, ray.direction);
    let c = dot(oc, oc) - sphere.radius * sphere.radius;
    let discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
        return -1.0;
    }

    let sqrtDiscriminant = sqrt(discriminant);
    let nearTime = (-b - sqrtDiscriminant) / (2.0f * a);
    let farTime = (-b + sqrtDiscriminant) / (2.0f * a);
    // time = select(farTime, nearTime, nearTime >= 0.0);
    return select(farTime, nearTime, nearTime >= 0.0);
}

fn planeIntersect(plane : Plane, transform : mat4x4<f32>, ray : Ray) -> f32 {
    // нормаль в мире (если у transform есть поворот/масштаб — иначе можно просто plane.normal)
    let n = normalize((transform * vec4f(plane.normal, 0.0)).xyz);
    let plane_pos = transform[3].xyz;

    let denom = dot(n, ray.direction);

    // луч параллелен — порог 1e-4, не 1e-6
    if (abs(denom) < 1e-4) {
        return -1.0;
    }

    let t = dot(n, plane_pos - ray.origin) / denom;

    return t;
}

fn meshIntersect(mesh : Mesh, transform : mat4x4<f32>, ray : Ray) -> TriangleHitInfo {
    var closestHit = TriangleHitInfo(vec3f(0.0), vec2f(0.0), INF);
    let indexBufferLength = arrayLength(&indices_buf);
    let vertexBufferLength = arrayLength(&vertices_buf);
    if (mesh.index_start > indexBufferLength) {
        return closestHit;
    }
    if (mesh.index_count > indexBufferLength - mesh.index_start) {
        return closestHit;
    }
    if (mesh.vertex_start > vertexBufferLength) {
        return closestHit;
    }
    if (mesh.vertex_count > vertexBufferLength - mesh.vertex_start) {
        return closestHit;
    }

    for (var i = 0u; i + 2u < mesh.index_count; i += 3u) {
        let indexOffset = mesh.index_start + i;
        let localIndex0 = indices_buf[indexOffset];
        let localIndex1 = indices_buf[indexOffset + 1u];
        let localIndex2 = indices_buf[indexOffset + 2u];

        let vertex0 = vertices_buf[mesh.vertex_start + localIndex0];
        let vertex1 = vertices_buf[mesh.vertex_start + localIndex1];
        let vertex2 = vertices_buf[mesh.vertex_start + localIndex2];
        let candidate = triangleIntersect(vertex0, vertex1, vertex2, transform, ray);
        if (candidate.time > 0.0 && candidate.time < closestHit.time) {
            closestHit = candidate;
        }
    }
    return closestHit;
}

fn sceneIntersect(ray : Ray) -> HitInfo {
    var sphere = Sphere();
    var plane = Plane();
    var hit = HitInfo(Material(), vec3f(0.), vec3f(0.), vec2f(0.), false, INF);

    let n = arrayLength(&objects_buf);
    for (var i = 0u; i < n; i = i + 1u) {
        let obj = objects_buf[i];
        var localTime = -1.0;
        var triangleHit = TriangleHitInfo(vec3f(0.0), vec2f(0.0), INF);

        if (obj.primitive_type == SPHERE) {
            sphere = sphereFrom(obj);
            localTime = sphereIntersect(sphere, obj.transform, ray);
        }
        else if (obj.primitive_type == PLANE) {
            plane = planeFrom(obj);
            localTime = planeIntersect(plane, obj.transform, ray);
        }
        else if (obj.primitive_type == MESH) {
            // triangleHit = meshIntersect(meshFrom(obj), obj.transform, ray);
            triangleHit = intersectBVH(meshFrom(obj), obj.transform, obj.invTransform, ray);

            localTime = triangleHit.time;
        }

        if (localTime >= 0.0 && localTime < hit.time) {
            hit.intersected = true;
            hit.time = localTime;
            hit.position = ray.origin + localTime * ray.direction;
            if (obj.primitive_type == PLANE) {
                var planeNormal = normalize((obj.transform * vec4f(plane.normal, 0.0)).xyz);
                if (dot(planeNormal, ray.direction) > 0.0) {
                    planeNormal = -planeNormal;
                }
                hit.normal = planeNormal;
            }
            else if (obj.primitive_type == SPHERE){
                hit.normal = normalize(hit.position - obj.transform[3].xyz);
            }
            else {
                hit.normal = triangleHit.normal;
                hit.uv = triangleHit.uv;
            }
            hit.material = materials_buf[obj.mat_ind];
        }
    }

    return hit;
}