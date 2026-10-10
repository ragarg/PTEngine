struct Material {
    albedo : vec4<f32>,
    emission : vec4<f32>,
    params : vec4<f32>,
    albedo_texture: u32,
}

fn getAlbedo(material : Material, uv : vec2<f32>) -> vec3<f32>{
    if (material.albedo_texture > 0) {
        return textureSampleLevel(texture_array_albedo, texture_sampler_pbr, uv, material.albedo_texture - 1, 0.0).rgb;
    }

    return material.albedo.rgb;
}

fn isEmissive(material : Material) -> bool {
    if (material.emission.r > 0.0 || material.emission.g > 0.0 || material.emission.b > 0.0) {
        return true;
    }
    else {
        return false;
    }
}