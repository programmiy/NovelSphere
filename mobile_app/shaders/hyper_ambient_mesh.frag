#version 460 core

#include <flutter/runtime_effect.glsl>

// ============================================================================
// LANOVEL Hyper-Aesthetic Luminary — Impeller Aurora Fluid Mesh Shader (.frag)
// ----------------------------------------------------------------------------
// Single-pass GPU procedural fluid mesh + micro film grain dithering.
// Zero offscreen saveLayer / zero BackdropFilter overhead (120Hz locked).
// ============================================================================

uniform vec2 uSize;        // [0, 1] Viewport width, height (px)
uniform float uTime;       // [2]    Continuous time in seconds
uniform float uIsDark;     // [3]    1.0 for dark themes, 0.0 for light themes
uniform float uIntensity;  // [4]    Theme-tuned aurora intensity multiplier
uniform vec3 uBgColor;     // [5..7] Theme base background RGB (0..1)
uniform vec3 uColor1;      // [8..10] Primary ambient luminary RGB (0..1)
uniform vec3 uColor2;      // [11..13] Secondary ambient luminary RGB (0..1)
uniform vec3 uColor3;      // [14..16] Tertiary iridescent highlight RGB (0..1)

out vec4 fragColor;

// High-frequency screen-space hash for anti-banding & subtle film grain
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 fragCoord = FlutterFragCoord().xy;
  vec2 safeSize = max(uSize, vec2(1.0));
  vec2 uv = fragCoord / safeSize;

  // Aspect-corrected coordinate space centered for organic flow
  float aspect = clamp(safeSize.x / safeSize.y, 0.4, 2.5);
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);

  // Slow, hypnotic time base
  float t = uTime * 0.42;

  // 2-stage iterative domain warping (Fluid Silk & Aurora Undulation)
  vec2 q = vec2(
    sin(p.x * 2.4 + t * 0.9) + cos(p.y * 2.0 - t * 0.7),
    cos(p.x * 2.1 - t * 0.8) + sin(p.y * 2.6 + t * 0.6)
  );

  vec2 r = vec2(
    sin(p.x * 2.8 + q.x * 1.35 + t * 0.75) + cos(p.y * 2.3 + q.y * 1.15 - t * 0.55),
    cos(p.x * 2.5 + q.y * 1.25 - t * 0.65) + sin(p.y * 2.9 + q.x * 1.40 + t * 0.85)
  );

  // Warped coordinate for fluid lobes
  vec2 wp = p + r * 0.16;

  // Three drifting aurora focal anchors in aspect space
  vec2 c1 = vec2(
    -0.22 * aspect + 0.18 * sin(t * 0.65),
    -0.28 + 0.12 * cos(t * 0.50)
  );
  vec2 c2 = vec2(
     0.28 * aspect + 0.16 * cos(t * 0.55 + 1.1),
    -0.04 + 0.16 * sin(t * 0.70)
  );
  vec2 c3 = vec2(
    -0.16 * aspect + 0.20 * sin(t * 0.48 + 2.4),
     0.32 + 0.13 * cos(t * 0.60 + 0.7)
  );

  // Silk fold harmonics for ribbon-like iridescence
  float silk = 0.5 + 0.5 * sin(wp.x * 3.2 - wp.y * 2.4 + r.x * 1.5 + t * 0.5);
  float ribbon = smoothstep(-0.6, 0.85, cos(q.x * 1.4 - r.y * 1.6 + t * 0.35));

  // Soft exponential falloffs modulated by silk harmonics
  float w1 = exp(-2.35 * length(wp - c1)) * (0.68 + 0.32 * silk);
  float w2 = exp(-2.55 * length(wp - c2)) * (0.65 + 0.35 * ribbon);
  float w3 = exp(-2.70 * length(wp - c3)) * (0.72 + 0.28 * (1.0 - silk));

  // Upper canopy aurora veil (gives extra depth behind app header)
  float canopy = exp(-3.4 * max(0.0, uv.y - 0.05 + 0.07 * r.y))
               * (0.55 + 0.45 * sin(uv.x * 3.14159 + q.x * 0.8 + t * 0.4));

  // Combine aurora contributions
  vec3 col = uBgColor;

  if (uIsDark > 0.5) {
    // Dark mode: rich emissive aurora glow + subtle iridescent interference
    vec3 aurora = uColor1 * (w1 * 0.42 + canopy * 0.18)
                + uColor2 * (w2 * 0.34)
                + uColor3 * (w3 * 0.28 + silk * ribbon * w1 * 0.14);
    // Screen-like soft blend to prevent harsh clipping
    col = col + aurora * uIntensity * (vec3(1.0) - col * 0.35);
  } else {
    // Light mode: pearlescent silk wash that preserves high text contrast
    vec3 tint1 = mix(uBgColor, uColor1, 0.22);
    vec3 tint2 = mix(uBgColor, uColor2, 0.18);
    vec3 tint3 = mix(uBgColor, uColor3, 0.16);

    col = mix(col, tint1, clamp((w1 + canopy * 0.4) * uIntensity, 0.0, 0.65));
    col = mix(col, tint2, clamp(w2 * uIntensity, 0.0, 0.55));
    col = mix(col, tint3, clamp(w3 * uIntensity, 0.0, 0.50));
  }

  // Subtle edge vignette to anchor reading focus
  float vig = smoothstep(1.15, 0.25, length(vec2((uv.x - 0.5) * 1.1, (uv.y - 0.5) * 1.1)));
  col = mix(col * (uIsDark > 0.5 ? 0.94 : 0.985), col, vig);

  // Micro film-grain dithering (eliminates 8-bit gradient banding & adds tactile texture)
  float noise = hash12(fragCoord + vec2(fract(uTime * 0.17) * 97.0, fract(uTime * 0.31) * 53.0)) - 0.5;
  float grainAmp = (uIsDark > 0.5 ? 0.016 : 0.009) * clamp(uIntensity, 0.4, 1.2);
  col = clamp(col + vec3(noise * grainAmp), 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
