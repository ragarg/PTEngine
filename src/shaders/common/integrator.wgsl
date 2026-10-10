#include "intersect.wgsl"
#include "sampler.wgsl"

fn directLight(hit : HitInfo, viewDirection : vec3<f32>, rng : ptr<function, u32>) -> vec3<f32> {
    if (frame.emissive_count == 0u) {
        return vec3f(0.0);
    }

    let emissiveIndex = u32(random01(rng) * f32(frame.emissive_count));
    let lightRef = emissive_objects_buf[emissiveIndex];
    let lightObject = objects_buf[lightRef.object_ind];

    let lightPos = lightObject.transform[3].xyz;
    let toLight = lightPos - hit.position;
    let lightDistanceSq = dot(toLight, toLight);
    let lightDistance = sqrt(max(lightDistanceSq, 1e-6));
    let lightDir = toLight / lightDistance;

    let nDotL = max(dot(hit.normal, lightDir), 0.0);
    if (nDotL <= 0.0) {
        return vec3f(0.0);
    }

    let shadowRay = Ray(hit.position + hit.normal * 1e-4, lightDir);
    let shadowHit = sceneIntersect(shadowRay);

    if (shadowHit.intersected && shadowHit.time < lightDistance && !isEmissive(shadowHit.material)) {
        return vec3f(0.0);
    }

    let material = materials_buf[lightObject.mat_ind];
    let emission = material.emission.rgb;

    let albedo = hit.material.albedo.rgb;
    let metallic = hit.material.albedo.a;
    let roughness = hit.material.emission.a;

    let brdf = evaluateBSDF(hit.normal, viewDirection, lightDir, albedo, metallic, roughness);
    let attenuation = 1.0 / max(lightDistanceSq, 1.0);

    return brdf * emission * nDotL * attenuation;
}

struct PathVertex {
    position : vec3<f32>,
    normal : vec3<f32>,
    viewDirection : vec3<f32>,
    throughput : vec3<f32>,
    materialIndex : u32,
}

fn connectPathVertices(cameraVertex : PathVertex, lightVertex : PathVertex) -> vec3<f32> {
    let toLight = lightVertex.position - cameraVertex.position;
    let distanceSq = dot(toLight, toLight);
    if (distanceSq <= 1e-8) {
        return vec3f(0.0);
    }

    let distance = sqrt(distanceSq);
    let direction = toLight / distance;
    let cameraCosine = max(dot(cameraVertex.normal, direction), 0.0);
    let lightCosine = max(dot(lightVertex.normal, -direction), 0.0);
    if (cameraCosine <= 0.0 || lightCosine <= 0.0) {
        return vec3f(0.0);
    }

    let epsilon = 1e-4;
    let cameraSide = select(-1.0, 1.0, dot(cameraVertex.normal, direction) > 0.0);
    let shadowRay = Ray(cameraVertex.position + cameraVertex.normal * cameraSide * epsilon, direction);
    let shadowHit = sceneIntersect(shadowRay);
    if (shadowHit.intersected && shadowHit.time < distance - 2.0 * epsilon) {
        return vec3f(0.0);
    }

    let cameraMaterial = materials_buf[cameraVertex.materialIndex];
    let lightMaterial = materials_buf[lightVertex.materialIndex];
    let cameraBrdf = evaluateBSDFAnisotropic(
        cameraVertex.normal,
        cameraVertex.viewDirection,
        direction,
        cameraMaterial.albedo.rgb,
        cameraMaterial.albedo.a,
        cameraMaterial.params.z,
        cameraMaterial.params.w
    );
    let lightBrdf = evaluateBSDFAnisotropic(
        lightVertex.normal,
        lightVertex.viewDirection,
        -direction,
        lightMaterial.albedo.rgb,
        lightMaterial.albedo.a,
        lightMaterial.params.z,
        lightMaterial.params.w
    );

    return cameraVertex.throughput * lightVertex.throughput * cameraBrdf * lightBrdf
        * cameraCosine * lightCosine / distanceSq;
}

// fn tracePathBDPT(ray_in : Ray, maxDepth : i32, rng : ptr<function, u32>) -> vec3<f32>{
//     var radiance = vec3f(0.0);
//     let cameraHit = sceneIntersect(ray_in);
//     if (!cameraHit.intersected) {
//         return radiance;
//     }
//     if (isEmissive(cameraHit.material)) {
//         return cameraHit.material.emission.rgb;
//     }
//     if (frame.emissive_count == 0u || maxDepth <= 0) {
//         return radiance;
//     }

//     let cameraVertex = PathVertex(
//         cameraHit.position,
//         cameraHit.normal,
//         -ray_in.direction,
//         vec3f(1.0),
//         cameraHit.mat_ind
//     );

//     let lightIndex = min(
//         u32(random01(rng) * f32(frame.emissive_count)),
//         frame.emissive_count - 1u
//     );
//     let lightRef = emissive_objects_buf[lightIndex];
//     let lightObject = objects_buf[lightRef.object_ind];
//     if (lightRef.primitive_type != SPHERE || lightObject.primitive_type != SPHERE) {
//         return radiance;
//     }

//     let center = lightObject.transform[3].xyz;
//     let radius = spheres_buf[lightObject.ind].radius;
//     let u1 = random01(rng);
//     let u2 = random01(rng);
//     let z = 1.0 - 2.0 * u1;
//     let radial = sqrt(max(0.0, 1.0 - z * z));
//     let phi = 2.0 * PI * u2;
//     let lightNormal = vec3f(radial * cos(phi), radial * sin(phi), z);
//     let lightPosition = center + radius * lightNormal;

//     let lightDirection = sampleCosineHemisphere(lightNormal, rng);
//     let emissionCosine = max(dot(lightNormal, lightDirection), 0.0);
//     let directionPdf = emissionCosine / PI;
//     let areaPdf = 1.0 / (4.0 * PI * radius * radius);
//     let lightSelectionPdf = 1.0 / f32(frame.emissive_count);
//     if (directionPdf <= 0.0 || areaPdf <= 0.0) {
//         return radiance;
//     }

//     let lightMaterial = materials_buf[lightObject.mat_ind];
//     var lightThroughput = lightMaterial.emission.rgb * emissionCosine
//         / (lightSelectionPdf * areaPdf * directionPdf);
//     var lightRay = Ray(lightPosition + lightNormal * 1e-4, lightDirection);

//     for (var depth = 0; depth < maxDepth; depth = depth + 1) {
//         let lightHit = sceneIntersect(lightRay);
//         if (!lightHit.intersected || isEmissive(lightHit.material)) {
//             break;
//         }

//         let lightVertex = PathVertex(
//             lightHit.position,
//             lightHit.normal,
//             -lightRay.direction,
//             lightThroughput,
//             lightHit.mat_ind
//         );
//         radiance += connectPathVertices(cameraVertex, lightVertex);

//         let viewDirection = -lightRay.direction;
//         let albedo = lightHit.material.albedo.rgb;
//         let metallic = lightHit.material.albedo.a;
//         let roughnessX = lightHit.material.params.z;
//         let roughnessY = lightHit.material.params.w;
//         let roughness = 0.5 * (roughnessX + roughnessY);
//         let pSpec = computeSpecularProbability(albedo, metallic, roughness);

//         var nextDirection = vec3f(0.0);
//         if (random01(rng) < pSpec) {
//             let sample = sampleGGXVNDFDirection(
//                 lightHit.normal,
//                 viewDirection,
//                 roughnessX * roughnessX,
//                 roughnessY * roughnessY,
//                 rng
//             );
//             let alpha = roughness * roughness;
//             // Передаём -V, потому что V у нас смотрит от поверхности, а Heitz ожидает "view direction"
//             // let H = sample_ggx_vndf(-V, alpha, alpha, rng);
//             // let L = reflect(-V, H); // reflect(V_incident, H) где V_incident = -V
//             // let pdfH = D_GGX(N, H, roughness) * max(dot(N, H), 0.0);
//             // let pdfL = pdfH / max(4.0 * dot(H, V), 1e-6);
//             if (sample.pdf <= 0.0) {
//                 break;
//             }
//             nextDirection = sample.vector;
//             // nextDirection = L;
//         } else {
//             nextDirection = sampleCosineHemisphere(lightHit.normal, rng);
//         }

//         let cosine = dot(lightHit.normal, nextDirection);
//         let pdf = evaluateVNDFMixturePDF(
//             lightHit.normal,
//             viewDirection,
//             nextDirection,
//             roughnessX * roughnessX,
//             roughnessY * roughnessY,
//             pSpec
//         );
//         if (cosine <= 0.0 || pdf <= 0.0) {
//             break;
//         }

//         let brdf = evaluateBSDFAnisotropic(
//             lightHit.normal,
//             viewDirection,
//             nextDirection,
//             albedo,
//             metallic,
//             roughnessX,
//             roughnessY
//         );
//         lightThroughput *= brdf * cosine / pdf;
//         lightRay = Ray(lightHit.position + lightHit.normal * 1e-4, nextDirection);
//     }

//     return radiance;
// }

fn albedo(ray_in : Ray) -> vec3<f32>{
    var radiance = vec3f(0.0);
    var throughput = vec3f(1.0);
    var ray = ray_in;

    let hit = sceneIntersect(ray);
    if (!hit.intersected) {
        return vec3f(0.5);
    } else {
        return getAlbedo(hit.material, hit.uv);
    }
}

fn tracePath(ray_in : Ray, maxDepth : i32, rng : ptr<function, u32>) -> vec3<f32>{
    var radiance = vec3f(0.0);
    var throughput = vec3f(1.0);
    var ray = ray_in;

    for (var depth = 0; depth < maxDepth; depth = depth + 1) {
        let hit = sceneIntersect(ray);
        if (!hit.intersected) {
            radiance += throughput * vec3f(0.0);
            break;
        }

        if (isEmissive(hit.material)) {
            radiance += throughput * hit.material.emission.rgb;
            break;
        }

        // Sampling 
        let viewDirection = -ray.direction;

        let albedo = getAlbedo(hit.material, hit.uv);
        let metallic = hit.material.albedo.a;
        let ior = hit.material.params.x;
        let transmission = hit.material.params.y;
        let roughnessX = hit.material.params.z;
        let roughnessY = hit.material.params.w;
        let roughness = 0.5 * (roughnessX + roughnessY);
        let alphaX = max(roughnessX * roughnessX, 1e-4);
        let alphaY = max(roughnessY * roughnessY, 1e-4);
        var normal = hit.normal;

        let pSpec = computeSpecularProbability(albedo, metallic, roughness);

        let is_entering = dot(ray.direction, normal) < 0.0;
        var eta1 = 1.0;
        var eta2 = ior;

        if (!is_entering) {
            normal = -normal;
            eta1 = ior;
            eta2 = 1.0;
        }

        let eta = eta1 / eta2;
        let cos_i = clamp(-dot(ray.direction, normal), 0.0, 1.0);
        
        var L = vec3f(0.);
        let scale = length(hit.position - ray.origin);
        let epsilon = 1e-5f * max(1.0f, scale);
        var pos = hit.position + normal * epsilon;
        let transmissionAmount = clamp(transmission, 0.0, 1.0);
        if (transmissionAmount > 0.0 && random01(rng) < transmissionAmount) {
            var microNormal = sampleGGXVNDFHalfVector(normal, viewDirection, alphaX, alphaY, rng);
            if (dot(ray.direction, microNormal) > 0.0) {
                microNormal = -microNormal;
            }
            let microCosine = clamp(-dot(ray.direction, microNormal), 0.0, 1.0);
            let F = fresnelDielectric(microCosine, eta1, eta2);
            let reflectionProbability = F;
            let transmissionProbability = 1.0 - F;
            let branchSample = random01(rng);

            if (branchSample < reflectionProbability) {
                L = normalize(reflect(ray.direction, microNormal));
            } else if (branchSample < reflectionProbability + transmissionProbability) {
                let transmittedDirection = refract(ray.direction, microNormal, eta);
                if (all(transmittedDirection == vec3<f32>(0.0))) {
                    L = normalize(reflect(ray.direction, microNormal));
                } else {
                    L = normalize(transmittedDirection);
                    let transmissionSide = select(-1.0, 1.0, dot(normal, L) > 0.0);
                    pos = hit.position + normal * transmissionSide * epsilon;
                    throughput *= eta * eta;
                }
            }
        } else {
            if (random01(rng) < pSpec) {
                let sample = sampleGGXVNDFDirection(normal, viewDirection, alphaX, alphaY, rng);
                L = sample.vector;
                if (sample.pdf <= 0.0) {
                    break;
                }
            } else {
                L = sampleCosineHemisphere(normal, rng);
            }

            let cosTheta = dot(normal, L);
            let pdf = evaluateVNDFMixturePDF(normal, viewDirection, L, alphaX, alphaY, pSpec);
            if (cosTheta <= 0.0 || pdf <= 0.0) {
                break;
            }

            let brdf = evaluateBSDFAnisotropic(normal, viewDirection, L, albedo, metallic, roughnessX, roughnessY);
            throughput *= brdf * cosTheta / pdf;
        }

        ray = Ray(pos, L);

        // Russian roulette
        if (depth > 3) {
            let p = clamp(max(throughput.r, max(throughput.g, throughput.b)), 0.0, 1.0);
            if (random01(rng) > p) {
                radiance = vec3f(0.0);
                break;
            }
            throughput /= p;
        }
    }
    return radiance;
}