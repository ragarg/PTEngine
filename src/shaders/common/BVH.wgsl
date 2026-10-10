struct TriangleHitInfo {
    normal : vec3<f32>,
    uv : vec2<f32>,
    time: f32,
}

struct Ray{
    origin : vec3<f32>,
    direction : vec3<f32>,
}

struct AABB {
    min: vec3<f32>,
    max: vec3<f32>
}

struct Triangle {
    v0 : Vertex,
    v1 : Vertex,
    v2 : Vertex,
}

const AABB_IND = 0;
const NUM_TRIANGLES_IND = 6;
const LEFT_CHILD_IND = 7;
const RIGHT_CHILD_IND = 8;
const FIRST_TRIANGLE_IND = 9;
const BVH_STACK_SIZE: u32 = 64u;

fn createAABB(ind: u32) -> AABB {
    return AABB(
        vec3f(
            bvh_buf[AABB_IND + ind],
            bvh_buf[AABB_IND + ind + 1],
            bvh_buf[AABB_IND + ind + 2],
        ),
        vec3f(
            bvh_buf[AABB_IND + ind + 3],
            bvh_buf[AABB_IND + ind + 4],
            bvh_buf[AABB_IND + ind + 5],
        ),
    );
}

fn getTriangle(mesh: Mesh, triangleIndex: u32) -> Triangle {
    let v0Index = mesh.index_start + triangleIndex * 3u;
    let v1Index = mesh.index_start + triangleIndex * 3u + 1u;
    let v2Index = mesh.index_start + triangleIndex * 3u + 2u;

    return Triangle(
        vertices_buf[mesh.vertex_start + indices_buf[v0Index]],
        vertices_buf[mesh.vertex_start + indices_buf[v1Index]],
        vertices_buf[mesh.vertex_start + indices_buf[v2Index]],
    );
}

// Möller–Trumbore intersection algorithm 
// https://en.wikipedia.org/wiki/M%C3%B6ller%E2%80%93Trumbore_intersection_algorithm
fn triangleIntersect(v0 : Vertex, v1 : Vertex, v2 : Vertex, invTransform : mat4x4<f32>, ray : Ray) -> TriangleHitInfo {
    let invalidHit = TriangleHitInfo(vec3f(0.0), vec2f(0.0), INF);
    let p0 = vec4f(v0.position.xyz, 1.0).xyz;
    let p1 = vec4f(v1.position.xyz, 1.0).xyz;
    let p2 = vec4f(v2.position.xyz, 1.0).xyz;
    let e1 = p1 - p0;
    let e2 = p2 - p0;
    let pvec = cross(ray.direction, e2);
    let det = dot(e1, pvec);

    if (abs(det) < 1e-7) {
        return invalidHit;
    }

    let invDet = 1.0 / det;

    let tvec = ray.origin - p0;
    let u = dot(tvec, pvec) * invDet;
    if (u < 0.0 || u > 1.0) {
        return invalidHit;
    }

    let qvec = cross(tvec, e1);
    let v = dot(ray.direction, qvec) * invDet;
    if (v < 0.0 || u + v > 1.0) {
        return invalidHit;
    }

    let t = dot(e2, qvec) * invDet;
    if (t <= 1e-5) {
        return invalidHit;
    }

    let normal = normalize((v0.normal * (1.0 - u - v) + v1.normal * u + v2.normal * v).xyz);
    let uv = (v0.uv * (1.0 - u - v) + v1.uv * u + v2.uv * v).xy;
    return TriangleHitInfo(normal, uv, t);
}

fn intersectBVH(mesh: Mesh, transform : mat4x4<f32>, invTransform : mat4x4<f32>, ray : Ray) -> TriangleHitInfo {
    var closestHit = TriangleHitInfo(vec3f(0.0), vec2f(0.0), INF);

    let bvh_num_node = bitcast<u32>(bvh_buf[mesh.BVH_start_ind]);

    let localOrigin    = (invTransform * vec4<f32>(ray.origin, 1.0)).xyz;
    let localDirection = (invTransform * vec4<f32>(ray.direction, 0.0)).xyz;
    let localRay = Ray(localOrigin, localDirection);
    let invDir = 1.0 / localDirection;

    var stack: array<u32, BVH_STACK_SIZE>;
    var stackSize = 0u;
    // stack[0] = mesh.BVH_start_ind + 1u;

    var bvh_node_start = mesh.BVH_start_ind + 1u;

    while (true) {
        let numTriangles = bitcast<u32>(bvh_buf[bvh_node_start + NUM_TRIANGLES_IND]);
        if (numTriangles > 0u) {
            let triangleDataStart = bvh_node_start + FIRST_TRIANGLE_IND;
            for (var i = 0u; i < numTriangles; i += 1u) {
                let triangleIndex = bitcast<u32>(bvh_buf[triangleDataStart + i]);
                let indexOffset = mesh.index_start + triangleIndex * 3u;
                let triangle = getTriangle(mesh, triangleIndex);
                let candidate = triangleIntersect(triangle.v0, triangle.v1, triangle.v2, invTransform, localRay);
                if (candidate.time > 0.0 && candidate.time < closestHit.time) {
                    closestHit = candidate;
                }
            }
            if (stackSize == 0) {
                break;
            } else {
                stackSize--;
                bvh_node_start = stack[stackSize];
            }
        } else {
            let leftOffset = bitcast<u32>(bvh_buf[bvh_node_start + LEFT_CHILD_IND]);
            let rightOffset = bitcast<u32>(bvh_buf[bvh_node_start + RIGHT_CHILD_IND]);

            var leftNode = mesh.BVH_start_ind + leftOffset;
            var rightNode = mesh.BVH_start_ind + rightOffset;

            var intersectsLeft = IntersectAABB(leftNode, localRay, invDir, closestHit.time);
            var intersectsRight = IntersectAABB(rightNode, localRay, invDir, closestHit.time);

            if (intersectsLeft > intersectsRight) {
                let time = intersectsRight;
                intersectsRight = intersectsLeft;
                intersectsLeft = time;

                let node = rightNode;
                rightNode = leftNode;
                leftNode = node;
            }

            if (intersectsLeft >= INF) {
                if (stackSize == 0) {
                    break;
                } else {
                    stackSize--;
                    bvh_node_start = stack[stackSize];
                }
            } else {
                bvh_node_start = leftNode;
                if (intersectsRight < INF) {
                    stack[stackSize] = rightNode;
                    stackSize++;
                }
            }
        }
    }
    return closestHit;
}

fn IntersectAABB(ind: u32, ray : Ray, invDir: vec3f, time: f32) -> f32 {
    let aabb = createAABB(ind);

    let tx1 = (aabb.min.x - ray.origin.x) * invDir.x;
    let tx2 = (aabb.max.x - ray.origin.x) * invDir.x;
    var tmin = min(tx1, tx2);
    var tmax = max(tx1, tx2);

    let ty1 = (aabb.min.y - ray.origin.y) * invDir.y;
    let ty2 = (aabb.max.y - ray.origin.y) * invDir.y;
    tmin = max(tmin, min(ty1, ty2));
    tmax = min(tmax, max(ty1, ty2));

    let tz1 = (aabb.min.z - ray.origin.z) * invDir.z;
    let tz2 = (aabb.max.z - ray.origin.z) * invDir.z;
    tmin = max(tmin, min(tz1, tz2));
    tmax = min(tmax, max(tz1, tz2));


    if (tmax >= tmin && tmin < time && tmax > 0.0) {
        return tmin;
    }
    return INF;
}