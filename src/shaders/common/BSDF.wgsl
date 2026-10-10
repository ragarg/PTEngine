const PI : f32 = 3.14159265358979;

// --- Normal Distribution Function (Trowbridge-Reitz / GGX) ---
// Описывает, как микрограни распределены по нормалям.
// roughness в [0.001, 1], alpha = roughness² (perceptual roughness).
fn D_GGX(N : vec3<f32>, H : vec3<f32>, roughness : f32) -> f32{
    let a  = roughness * roughness;
    let a2 = a * a;
    let NdotH  = max(dot(N, H), 0.0);
    let NdotH2 = NdotH * NdotH;
    let denom  = NdotH2 * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom);
}

fn D_GGXAnisotropic(N : vec3<f32>, H : vec3<f32>, roughnessX : f32, roughnessY : f32) -> f32 {
    let basis = buildBasis(N);
    let Hlocal = vec3f(dot(H, basis.T), dot(H, basis.B), max(dot(H, basis.N), 0.0));
    let alphaX = max(roughnessX * roughnessX, 1e-4);
    let alphaY = max(roughnessY * roughnessY, 1e-4);
    let x = Hlocal.x / alphaX;
    let y = Hlocal.y / alphaY;
    let denominator = x * x + y * y + Hlocal.z * Hlocal.z;
    return 1.0 / max(PI * alphaX * alphaY * denominator * denominator, 1e-8);
}

fn G1_GGXAnisotropic(N : vec3<f32>, V : vec3<f32>, roughnessX : f32, roughnessY : f32) -> f32 {
    let basis = buildBasis(N);
    let Vlocal = vec3f(dot(V, basis.T), dot(V, basis.B), abs(dot(V, basis.N)));
    let alphaX = max(roughnessX * roughnessX, 1e-4);
    let alphaY = max(roughnessY * roughnessY, 1e-4);
    let xy = alphaX * alphaX * Vlocal.x * Vlocal.x + alphaY * alphaY * Vlocal.y * Vlocal.y;
    return 2.0 * Vlocal.z / max(Vlocal.z + sqrt(Vlocal.z * Vlocal.z + xy), 1e-6);
}

fn G_SmithAnisotropic(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, roughnessX : f32, roughnessY : f32) -> f32 {
    return G1_GGXAnisotropic(N, V, roughnessX, roughnessY)
        * G1_GGXAnisotropic(N, L, roughnessX, roughnessY);
}

// --- Geometry Function (Smith + Schlick-GGX) ---
// Учитывает самозатенение микрограней.
fn G_SchlickGGX(NdotV : f32, roughness : f32) -> f32 {
    // Для IBL и прямого освещения параметр k разный; для path tracing
    // используем k = (r+1)²/8 — корректно для аналитических источников.
    let r = roughness + 1.0;
    let k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}

fn G_Smith(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, roughness : f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    return G_SchlickGGX(NdotV, roughness) * G_SchlickGGX(NdotL, roughness);
}

// --- Fresnel (Schlick) ---
fn F_Schlick(cosTheta : f32, F0: vec3<f32>) -> vec3<f32> {
    let f = pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
    return F0 + (vec3f(1.0f) - F0) * f;
}

// --- F0 из металличности ---
// Диэлектрики: 0.04 (≈4% отражения на нормальном падении).
// Металлы: F0 = albedo.
fn ComputeF0(albedo : vec3<f32>, metallic : f32) -> vec3<f32> {
    let dielectricF0 = vec3f(0.04);
    return mix(dielectricF0, albedo, metallic);
}

// --- Полная Cook-Torrance BRDF ---
// Возвращает значение f_r(ω_i, ω_o) — без косинуса, он учитывается отдельно.
fn evaluateBSDF(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, albedo : vec3<f32>, metallic : f32, roughness : f32) -> vec3<f32> {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    if (NdotV <= 0.0 || NdotL <= 0.0) {
        return vec3f(0.0);
    }

    let H = normalize(V + L);
    let NdotH = max(dot(N, H), 0.0);
    let HdotV = max(dot(H, V), 0.0);

    let F0 = ComputeF0(albedo, metallic);

    // --- Спекулярная часть ---
    let D = D_GGX(N, H, roughness);
    let G = G_Smith(N, V, L, roughness);
    let F = F_Schlick(HdotV, F0);
    let specular = (D * G * F) / max(4.0 * NdotV * NdotL, 1e-6);

    // --- Диффузная часть (Lambert, модулированная Fresnel и metallic) ---
    // kD = (1 - F) * (1 - metallic) — энергосохранение.
    let kD = (vec3f(1.0) - F) * (1.0 - metallic);
    let diffuse = kD * albedo / PI;

    return diffuse + specular;
}

fn evaluateBSDFAnisotropic(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, albedo : vec3<f32>, metallic : f32, roughnessX : f32, roughnessY : f32) -> vec3<f32> {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    if (NdotV <= 0.0 || NdotL <= 0.0) {
        return vec3f(0.0);
    }

    let H = normalize(V + L);
    let HdotV = max(dot(H, V), 0.0);
    let F0 = ComputeF0(albedo, metallic);
    let D = D_GGXAnisotropic(N, H, roughnessX, roughnessY);
    let G = G_SmithAnisotropic(N, V, L, roughnessX, roughnessY);
    let F = F_Schlick(HdotV, F0);
    let specular = (D * G * F) / max(4.0 * NdotV * NdotL, 1e-6);
    let kD = (vec3f(1.0) - F) * (1.0 - metallic);
    let diffuse = kD * albedo / PI;
    return diffuse + specular;
}

fn computeSpecularProbability(albedo : vec3<f32>, metallic : f32, roughness : f32) -> f32{
    // Простая эвристика; в продакшене берут из Fresnel при NdotV.
    var spec = metallic + (1.0 - metallic) * 0.04;
    // Прибавим немного от гладкости, чтобы не сэмплировать диффуз в зеркало.
    spec = max(spec, 1.0 - roughness);
    return clamp(spec, 0.05, 0.95); // не даём застрять на 0 или 1
}