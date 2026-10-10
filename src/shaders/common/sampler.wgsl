#include "BSDF.wgsl"

struct SamplerData {
    vector : vec3<f32>,
    pdf : f32
}

struct Basis {
    T : vec3<f32>,
    B : vec3<f32>,
    N : vec3<f32>,
}

// PCG-подобный хэш. Вход: seed + счётчик. Выход: 32-битное число.
fn pcg_hash(state : u32) -> u32 {
    var s = state * 747796405u + 2891336453u;
    let word = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (word >> 22u) ^ word;
}

// Возвращает случайное число [0, 1)
fn random01(seed : ptr<function, u32>) -> f32 {
    *seed = *seed + 1u;
    let h = pcg_hash(*seed);
    return f32(h) / 4294967296.0; // делим на 2^32
}

// --- Ортонормальный базис вокруг нормали ---
// Метод Duff et al. (2017): без ветвлений, численно устойчив.
// Даёт гарантированно ортонормальный {tangent, bitangent, N}.
fn buildBasis(N : vec3<f32>) -> Basis {
    let sign = select(-1.0, 1.0, N.z >= 0.0);
    let a = -1.0 / (sign + N.z);
    let b = N.x * N.y * a;
    var basis = Basis(
        vec3f(1.0f + sign * N.x * N.x * a, sign * b, -sign * N.x),
        vec3f(b, sign + N.y * N.y * a, -N.y),
        N
    );

    return basis;
}

// --- Cosine-weighted sampling на полусфере ---
// Возвращает направление в мировом пространстве, лежащее в полусфере вокруг N.
// PDF можно вычислить как dot(N, L) / pi — здесь мы её не считаем,
// потому что она тривиально выражается через результат.
fn sampleCosineHemisphere(N : vec3<f32>, rng : ptr<function, u32>) -> vec3f {
    // 1. Сэмплируем в локальной системе, где N = +Z
    let u1 = random01(rng);
    let u2 = random01(rng);

    let phi = 2.0 * PI * u1;
    let cosTheta = sqrt(1.0 - u2); // = sqrt(u2) если u2 поменять местами — см. ниже
    let sinTheta = sqrt(u2);
    // Внимание: какое из двух — cos, какое — sin, не важно для равномерности,
    // важно лишь что cos² + sin² = 1 и PDF получится правильный.
    // Я использую cosTheta = sqrt(1 - u2), sinTheta = sqrt(u2).
    // Тогда PDF = cosTheta/pi — правильная.

    let localDir = vec3f(
        cos(phi) * sinTheta,
        sin(phi) * sinTheta,
        cosTheta
    );

    // 2. Переносим в мировую систему через базис вокруг N
    
    let basis = buildBasis(N);
    return normalize(basis.T * localDir.x + basis.B * localDir.y + N * localDir.z);
}

// // --- PDF для cosine-weighted ---
// // Используй эту функцию, если хочешь честно делить на PDF в общем виде.
// static float CosineHemispherePDF(const glm::vec3& N, const glm::vec3& L) {
//     float cosTheta = glm::dot(N, L);
//     if (cosTheta <= 0.0f) return 0.0f;
//     return cosTheta / 3.14159265358979f;
// }

fn sampleGGXHalfVector(N : vec3<f32>, roughness : f32, rng : ptr<function, u32>) -> SamplerData {
    let a  = roughness * roughness;
    let a2 = a * a;
    let u1 = random01(rng);
    let u2 = random01(rng);

    let phi = 2.0 * PI * u1;
    // Из обратного CDF для GGX:
    // cos θ = sqrt( (1 - u2) / (1 + (a² - 1) u2) )
    let cosTheta = sqrt((1.0 - u2) / (1.0 + (a2 - 1.0) * u2));
    let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));

    let H_local = vec3f(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);

    // Переносим в мировое пространство вокруг N
    var basis = buildBasis(N);
    let H = normalize(basis.T * H_local.x + basis.B * H_local.y + basis.N * H_local.z);

    // PDF по H: D(H) * NdotH
    let NdotH = max(dot(N, H), 0.0);
    let pdfH = D_GGX(N, H, roughness) * NdotH;
    return SamplerData(H, pdfH);
}

// Сэмплирование направления L для спекулярной части.
// Возвращает L и PDF по L (с учётом перехода H → L через отражение).
fn sampleGGXDirection(N : vec3<f32>, V : vec3<f32>, roughness : f32, rng : ptr<function, u32>) -> SamplerData {
    let samplerH = sampleGGXHalfVector(N, roughness, rng);
    let H = samplerH.vector;
    let pdfH = samplerH.pdf;

    // L = reflect(-V, H)
    let L = normalize(2.0 * dot(V, H) * H - V);

    // Якобиан перехода от H к L: dω_H / dω_L = 1 / (4 * HdotV)
    let HdotV = max(dot(H, V), 0.0);
    var pdfL = pdfH / max(4.0f * HdotV, 1e-6);

    // Если L ушло под поверхность — обнуляем PDF (выборка отбрасывается)
    if (dot(N, L) <= 0.0) {
        pdfL = 0.0;
    }
    return SamplerData(L, pdfL);
}

// Heitz 2018: Sampling the GGX Distribution of Visible Normals
fn sample_ggx_vndf(Ve: vec3<f32>, alpha_x: f32, alpha_y: f32, rng: ptr<function, u32>) -> vec3<f32> {
    // 1. Преобразуем V в пространство полусферы (Heitz использует -V как "view")
    let Vh = normalize(vec3<f32>(alpha_x * Ve.x, alpha_y * Ve.y, Ve.z));

    // 2. Построим ортонормальный базис вокруг Vh
    let lensq = Vh.x * Vh.x + Vh.y * Vh.y;
    var T1: vec3<f32>;
    if (lensq > 0.0) {
        T1 = vec3<f32>(-Vh.y, Vh.x, 0.0) / sqrt(lensq);
    } else {
        T1 = vec3<f32>(1.0, 0.0, 0.0);
    }
    let T2 = cross(Vh, T1);

    // 3. Сэмплируем точку на диске (P concentric)
    let u1 = random01(rng);
    let u2 = random01(rng);
    let r = sqrt(u1);
    let phi = 2.0 * PI * u2;
    let p1 = r * cos(phi);
    let p2 = r * sin(phi);

    // 4. Проекция на полусферу
    let s = 0.5 * (1.0 + Vh.z);
    let p2_ = (1.0 - s) * sqrt(max(0.0, 1.0 - p1 * p1)) + s * p2;
    let Nh = p1 * T1 + p2_ * T2 + sqrt(max(0.0, 1.0 - p1 * p1 - p2_ * p2_)) * Vh;

    // 5. Обратно в исходное пространство
    let Ne = normalize(vec3<f32>(alpha_x * Nh.x, alpha_y * Nh.y, max(0.0, Nh.z)));
    return Ne;
}

fn sampleGGXVNDFHalfVector(N : vec3<f32>, V : vec3<f32>, alpha_x : f32, alpha_y : f32, rng : ptr<function, u32>) -> vec3<f32> {
    let basis = buildBasis(N);
    let viewLocal = normalize(vec3f(dot(V, basis.T), dot(V, basis.B), abs(dot(V, N))));
    let halfLocal = sample_ggx_vndf(viewLocal, max(alpha_x, 1e-4), max(alpha_y, 1e-4), rng);
    return normalize(basis.T * halfLocal.x + basis.B * halfLocal.y + basis.N * halfLocal.z);
}

fn sampleGGXVNDFDirection(N : vec3<f32>, V : vec3<f32>, alpha_x : f32, alpha_y : f32, rng : ptr<function, u32>) -> SamplerData {
    let NdotV = dot(N, V);
    if (NdotV <= 1e-6) {
        return SamplerData(vec3f(0.0), 0.0);
    }

    let basis = buildBasis(N);
    let viewLocal = normalize(vec3f(dot(V, basis.T), dot(V, basis.B), NdotV));
    let alphaX = max(alpha_x, 1e-4);
    let alphaY = max(alpha_y, 1e-4);
    let halfLocal = sample_ggx_vndf(viewLocal, alphaX, alphaY, rng);
    let H = normalize(basis.T * halfLocal.x + basis.B * halfLocal.y + basis.N * halfLocal.z);
    let L = normalize(reflect(-V, H));
    let NdotL = dot(N, L);
    if (NdotL <= 0.0) {
        return SamplerData(L, 0.0);
    }

    // Visible-normal PDF transformed from half-vector space to reflected direction space.
    let roughnessX = sqrt(alphaX);
    let roughnessY = sqrt(alphaY);
    let pdfL = D_GGXAnisotropic(N, H, roughnessX, roughnessY)
        * G1_GGXAnisotropic(N, V, roughnessX, roughnessY) / max(4.0 * NdotV, 1e-6);
    return SamplerData(L, pdfL);
}

fn fresnelDielectric(cosTheta_i: f32, eta1: f32, eta2: f32) -> f32 {
    // cosTheta_i — косинус угла падения (положительный)
    var eta_i = eta1;
    var eta_t = eta2;
    var cos_i = cosTheta_i;

    if (eta_i > eta_t) {
        // Выходим из плотной среды — возможен TIR
        let sin_t2 = (eta_i / eta_t) * (eta_i / eta_t) * (1.0 - cos_i * cos_i);
        if (sin_t2 > 1.0) {
            return 1.0; // TIR — всё отражается
        }
        cos_i = sqrt(1.0 - (eta_i / eta_t) * (eta_i / eta_t) * (1.0 - cos_i * cos_i));
        // Меняем местами, чтобы формула Шлика была в "правильной" системе
        let tmp = eta_i; eta_i = eta_t; eta_t = tmp;
    }

    let r0 = (eta_i - eta_t) / (eta_i + eta_t);
    let r0_2 = r0 * r0;
    let one_minus_cos = 1.0 - cos_i;
    return r0_2 + (1.0 - r0_2) * one_minus_cos * one_minus_cos * one_minus_cos * one_minus_cos * one_minus_cos;
    //                                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //                                                              это pow(1 - cos, 5)
}

fn evaluateVNDFMixturePDF(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, alpha_x : f32, alpha_y : f32, pSpec : f32) -> f32 {
    let NdotL = dot(N, L);
    let NdotV = dot(N, V);
    if (NdotL <= 0.0 || NdotV <= 1e-6) {
        return 0.0;
    }

    let pdfDiffuse = NdotL / PI;
    let H = normalize(V + L);
    let roughnessX = sqrt(max(alpha_x, 1e-4));
    let roughnessY = sqrt(max(alpha_y, 1e-4));
    let pdfSpecular = D_GGXAnisotropic(N, H, roughnessX, roughnessY)
        * G1_GGXAnisotropic(N, V, roughnessX, roughnessY) / max(4.0 * NdotV, 1e-6);
    return pSpec * pdfSpecular + (1.0 - pSpec) * pdfDiffuse;
}

// Общая PDF для смешанного сэмплера (используется при взвешивании).
fn evaluatePDF(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, albedo : vec3<f32>, metallic : f32, roughness : f32, pSpec : f32) -> f32 {
    // PDF диффузной стратегии: cosine-weighted
    let NdotL = dot(N, L);
    if (NdotL <= 0.0) {
        return 0.0;
    }
    let pdfDiffuse = NdotL / PI;

    // PDF спекулярной стратегии: D * NdotH / (4 * HdotV)
    var pdfSpecular = 0.0;

    let H = normalize(V + L);
    let NdotH = max(dot(N, H), 0.0);
    let HdotV = max(dot(H, V), 0.0);
    let D = D_GGX(N, H, roughness);
    pdfSpecular = D * NdotH / max(4.0 * HdotV, 1e-6);

    // Смесь
    return pSpec * pdfSpecular + (1.0 - pSpec) * pdfDiffuse;
}