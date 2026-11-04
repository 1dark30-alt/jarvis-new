'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { STLLoader } from 'three-stdlib';
import { AnimatePresence, motion } from 'framer-motion';
import * as THREE from 'three';
import { PageHeader } from '../PageHeader';
import { sfx } from '../../lib/sfx';
import { WebFluidFormulaLab } from './WebFluidFormulaLab';

// ── Assets ────────────────────────────────────────────────────────────────────
const BASE_URL = '/models/SpiderMan/WebShooters/webshooter_base.stl';
const BUTTON_URL = '/models/SpiderMan/WebShooters/button.stl';
const CART_URL = '/models/SpiderMan/WebShooters/cart.stl';

// One STL per slot, each modeled IN PLACE on the base (correct corner position
// and roll baked in). Quadrant letters are used to strip stray geometry that
// leaked into an export (Back Right.stl also contains a front-left cart).
export type Quad = 'FR' | 'FL' | 'BR' | 'BL';
const SLOT_FILES: { url: string; quad: Quad; label: string }[] = [
  { url: '/models/SpiderMan/WebShooters/Front left.stl', quad: 'FL', label: 'Front Left' },
  { url: CART_URL, quad: 'FR', label: 'Front Right' },
  { url: '/models/SpiderMan/WebShooters/Back Left.stl', quad: 'BL', label: 'Back Left' },
  { url: '/models/SpiderMan/WebShooters/Back Right.stl', quad: 'BR', label: 'Back Right' },
];
const QUAD_SPLIT_Y = -40; // front carts live above this model-space Y, back below

const ACCENT = '#22d3ee';
const ACCENT_DIM = 'rgba(34,211,238,';
const DANGER = '#ff4d4d';

// World size of the base model in the left canvas
const BASE_SIZE = 3.2;

// ── Cartridge catalog ─────────────────────────────────────────────────────────
type CartTypeId = 'taser' | 'v1' | 'grenade' | 'acid';

interface SliderDef {
  id: string;
  label: string;
  unit: string;
  max: number;
  initial: number;
}

interface CartTypeDef {
  id: CartTypeId;
  name: string;
  sub: string;
  color: string;       // holo/UI tint
  liquid?: string;     // liquid color (non-taser)
  hasDetonator: boolean;
  sliders: SliderDef[];
}

const CART_TYPES: CartTypeDef[] = [
  {
    id: 'taser',
    name: 'Taser Webs',
    sub: 'Electrified web line',
    color: '#7df9ff',
    hasDetonator: true,
    sliders: [],
  },
  {
    id: 'v1',
    name: 'Web Fluid V1',
    sub: 'Standard synthetic web',
    color: '#dfe9f2',
    liquid: '#c9dcea',
    hasDetonator: false,
    sliders: [
      { id: 'alcohol', label: 'Alcohol', unit: 'mL', max: 100, initial: 40 },
      { id: 'h2o', label: 'H2O', unit: 'mL', max: 100, initial: 55 },
      { id: 'salicylic', label: 'Salicylic Acid', unit: 'mL', max: 100, initial: 25 },
      { id: 'toluene', label: 'Toluene', unit: 'mL', max: 100, initial: 30 },
      { id: 'methanol', label: 'Methanol', unit: 'mL', max: 100, initial: 20 },
      { id: 'xanthan', label: 'Xanthan Gum', unit: 'mL', max: 100, initial: 15 },
    ],
  },
  {
    id: 'grenade',
    name: 'Web Grenades',
    sub: 'Impact-burst payload',
    color: '#ffb454',
    liquid: '#ff9838',
    hasDetonator: true,
    sliders: [
      { id: 'gunpowder', label: 'Gunpowder', unit: 'mL', max: 100, initial: 45 },
      { id: 'v1formula', label: 'Web Fluid V1 Formula', unit: 'mL', max: 100, initial: 60 },
    ],
  },
  {
    id: 'acid',
    name: 'Acid Web',
    sub: 'Corrosive dissolution line',
    color: '#5dff70',
    liquid: '#38e858',
    hasDetonator: false,
    sliders: [
      { id: 'hcl', label: 'Hydrochloric Acid', unit: 'mL', max: 100, initial: 50 },
      { id: 'v1formula', label: 'Web Fluid V1', unit: 'mL', max: 100, initial: 45 },
    ],
  },
];

interface InstalledCart {
  type: CartTypeId;
  color: string;
  installedAt: number;
}

// ── Simple hologram shader (self-contained; fresnel + scanlines) ─────────────
const HOLO_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldY = worldPos.y;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = viewMatrix * worldPos;
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const HOLO_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;
  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 1.8);
    float scan = 0.78 + 0.22 * sin(vWorldY * 55.0 - uTime * 5.0);
    float flicker = 0.94 + 0.06 * sin(uTime * 23.0 + vWorldY * 4.0);
    vec3 col = uColor * (0.28 + fresnel * 1.7) * scan * flicker;
    float alpha = clamp(0.16 + fresnel * 1.1, 0.0, 1.0) * uIntensity;
    gl_FragColor = vec4(col, alpha);
  }
`;

function makeHolo(color: string, intensity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uIntensity: { value: intensity },
    },
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** Pointer capture that tolerates synthetic/injected pointer ids (IR touch film). */
function safeCapture(el: Element, pointerId: number) {
  try { el.setPointerCapture(pointerId); } catch { /* inactive pointer id */ }
}

/** Keep only the triangles whose centroid falls in the given base quadrant. */
export function filterQuadrant(geom: THREE.BufferGeometry, quad: Quad): THREE.BufferGeometry {
  const pos = geom.attributes.position;
  const norm = geom.attributes.normal as THREE.BufferAttribute | undefined;
  const outP: number[] = [];
  const outN: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    let cx = 0, cy = 0;
    for (let v = 0; v < 3; v++) { cx += pos.getX(i + v); cy += pos.getY(i + v); }
    cx /= 3; cy /= 3;
    const q = ((cy > QUAD_SPLIT_Y ? 'F' : 'B') + (cx > 0 ? 'R' : 'L')) as Quad;
    if (q !== quad) continue;
    for (let v = 0; v < 3; v++) {
      outP.push(pos.getX(i + v), pos.getY(i + v), pos.getZ(i + v));
      if (norm) outN.push(norm.getX(i + v), norm.getY(i + v), norm.getZ(i + v));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3));
  if (norm) g.setAttribute('normal', new THREE.Float32BufferAttribute(outN, 3));
  g.computeBoundingBox();
  return g;
}

function makeGlowTexture(color: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, color);
  grad.addColorStop(0.4, color + '66');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

// ── Left canvas: holographic base + button + installed carts ─────────────────
// Each slot has its own STL modeled in place on the base, so installing a cart
// just renders that slot's geometry inside the shared assembly chain — the
// right shape automatically "clicks in" wherever it's dropped.
function HoloBase({ armed, slots, hoverQuadrant, yawRef, onSlotScreens, onEject }: {
  armed: boolean;
  slots: (InstalledCart | null)[];
  hoverQuadrant: number | null;
  /** User-controlled base spin (radians), read every frame */
  yawRef: React.MutableRefObject<number>;
  /** Reports each slot's projected screen position (normalized 0..1) */
  onSlotScreens: (screens: { nx: number; ny: number }[]) => void;
  onEject: (i: number) => void;
}) {
  const baseGeom = useLoader(STLLoader, BASE_URL);
  const buttonGeom = useLoader(STLLoader, BUTTON_URL);
  const slotRaw = useLoader(STLLoader, SLOT_FILES.map((f) => f.url));

  // Strip stray triangles so each slot geometry is exactly one cart
  const slotGeoms = useMemo(
    () => slotRaw.map((g, i) => filterQuadrant(g, SLOT_FILES[i].quad)),
    [slotRaw],
  );
  useEffect(() => () => slotGeoms.forEach((g) => g.dispose()), [slotGeoms]);

  const baseMat = useMemo(() => makeHolo(ACCENT, 1), []);
  const buttonMat = useMemo(() => makeHolo(ACCENT, 1.35), []);
  const cartMats = useMemo(
    () => Object.fromEntries(CART_TYPES.map((t) => [t.id, makeHolo(t.color, 1.5)])) as Record<CartTypeId, THREE.ShaderMaterial>,
    [],
  );
  useEffect(() => () => {
    baseMat.dispose();
    buttonMat.dispose();
    Object.values(cartMats).forEach((m) => m.dispose());
  }, [baseMat, buttonMat, cartMats]);

  // Everything is placed in the STL's native assembly space (Z-up, millimetres)
  // inside one shared rotate/scale chain, so parts stay aligned as modeled.
  const layout = useMemo(() => {
    baseGeom.computeBoundingBox();
    const bb = baseGeom.boundingBox!;
    const bSize = bb.getSize(new THREE.Vector3());
    const bCenter = bb.getCenter(new THREE.Vector3());
    const s = BASE_SIZE / (Math.max(bSize.x, bSize.y, bSize.z) || 1);

    buttonGeom.computeBoundingBox();
    const btnB = buttonGeom.boundingBox!;
    const btnCenter = btnB.getCenter(new THREE.Vector3());

    // Slot centers/sizes straight from each in-place geometry
    const slotCenters = slotGeoms.map((g) => g.boundingBox!.getCenter(new THREE.Vector3()));
    const slotSizes = slotGeoms.map((g) => g.boundingBox!.getSize(new THREE.Vector3()));

    return {
      scale: s,
      offset: [-bCenter.x * s, -bb.min.z * s, bCenter.y * s] as const,
      topZ: bb.max.z,
      slotCenters,
      slotSizes,
      // Button: centered on the base, sunk into the top channel (not sitting
      // proud on the surface). ~7 mm below flush in model units.
      buttonRest: [
        bCenter.x - btnCenter.x,
        bCenter.y - btnCenter.y,
        bb.max.z - btnB.max.z - 7,
      ] as const,
      buttonRise: (BASE_SIZE * 0.48) / s, // world forward travel → assembly units (~3× prior)
    };
  }, [baseGeom, buttonGeom, slotGeoms]);

  const buttonRef = useRef<THREE.Group>(null);
  const groupRef = useRef<THREE.Group>(null);
  const markerRefs = useRef<(THREE.Object3D | null)[]>([null, null, null, null]);
  const projV = useMemo(() => new THREE.Vector3(), []);

  // Mutating three.js uniforms/transforms in the frame loop is the intended
  // three.js pattern, not a React state violation.
  /* eslint-disable react-hooks/immutability */
  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    baseMat.uniforms.uTime.value = t;
    buttonMat.uniforms.uTime.value = t;
    Object.values(cartMats).forEach((m) => { m.uniforms.uTime.value = t; });
    // Button slides forward out the front of the assembly (+Y, the fork end)
    // when armed — height stays fixed
    if (buttonRef.current) {
      const target = layout.buttonRest[1] + (armed ? layout.buttonRise : 0);
      buttonRef.current.position.y += (target - buttonRef.current.position.y) * Math.min(1, delta * 6);
    }
    // User-controlled spin + gentle hover float
    if (groupRef.current) {
      groupRef.current.position.y = 0.05 + Math.sin(t * 1.2) * 0.03;
      groupRef.current.rotation.y += (yawRef.current - groupRef.current.rotation.y) * Math.min(1, delta * 12);
    }
    // Project each slot center to normalized screen coords so drops land on the
    // correct quadrant no matter how the base is spun
    const screens = markerRefs.current.map((m) => {
      if (!m) return { nx: -1, ny: -1 };
      m.getWorldPosition(projV);
      projV.project(state.camera);
      return { nx: (projV.x + 1) / 2, ny: (1 - projV.y) / 2 };
    });
    onSlotScreens(screens);
  });

  useEffect(() => {
    buttonMat.uniforms.uColor.value = new THREE.Color(armed ? DANGER : ACCENT);
  }, [armed, buttonMat]);
  /* eslint-enable react-hooks/immutability */

  const glowTex = useMemo(() => makeGlowTexture(ACCENT), []);

  return (
    <group ref={groupRef}>
      {/* Floor glow + podium ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
        <circleGeometry args={[2.6, 48]} />
        <meshBasicMaterial map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.4} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.01}>
        <ringGeometry args={[2.1, 2.16, 72]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>

      {/* One shared assembly-space chain: base, button, slots, carts */}
      <group position={[layout.offset[0], layout.offset[1], layout.offset[2]]} scale={layout.scale}>
        <group rotation-x={-Math.PI / 2}>
          <mesh geometry={baseGeom} material={baseMat} />
          <group ref={buttonRef} position={[layout.buttonRest[0], layout.buttonRest[1], layout.buttonRest[2]]}>
            <mesh geometry={buttonGeom} material={buttonMat} />
          </group>

          {/* Slot markers (for screen projection) + target plates while dragging */}
          {layout.slotCenters.map((c, i) => (
            <group key={i}>
              <object3D
                ref={(o) => { markerRefs.current[i] = o; }}
                position={[c.x, c.y, layout.topZ]}
              />
              <mesh position={[c.x, c.y, layout.topZ + 0.6]} visible={hoverQuadrant !== null}>
                <planeGeometry args={[layout.slotSizes[i].x * 1.3, layout.slotSizes[i].y * 1.15]} />
                <meshBasicMaterial
                  color={hoverQuadrant === i ? ACCENT : '#ffffff'}
                  transparent
                  opacity={hoverQuadrant === i ? 0.35 : 0.07}
                  depthWrite={false}
                  blending={THREE.AdditiveBlending}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </group>
          ))}

          {/* Installed cartridges — each slot's own in-place geometry */}
          {slots.map((cart, i) =>
            cart ? (
              <InstalledCartMesh
                key={`${i}-${cart.installedAt}`}
                geometry={slotGeoms[i]}
                material={cartMats[cart.type]}
                dropHeight={layout.slotSizes[i].z * 4}
                onClick={() => onEject(i)}
              />
            ) : null,
          )}
        </group>
      </group>

      {/* Armed warning light */}
      {armed && <pointLight position={[0, 1.4, 0]} color={DANGER} intensity={3} distance={6} />}
    </group>
  );
}

function InstalledCartMesh({ geometry, material, dropHeight, onClick }: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  dropHeight: number;
  onClick: () => void;
}) {
  const grow = useRef(0);
  const ref = useRef<THREE.Group>(null);

  // Drop in from above (assembly +Z = world up), with a tiny settle bounce
  useFrame((_, delta_) => {
    if (!ref.current || grow.current >= 1) return;
    grow.current = Math.min(1, grow.current + delta_ / 0.3);
    const g = grow.current;
    const ease = 1 - Math.pow(1 - g, 3);
    const bounce = Math.sin(Math.min(1, g * 1.4) * Math.PI) * 0.06;
    ref.current.position.z = (1 - ease) * dropHeight + bounce * dropHeight * (1 - g);
  });

  return (
    <group
      ref={ref}
      position={[0, 0, dropHeight]}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <mesh geometry={geometry} material={material} />
    </group>
  );
}

// ── Lightning effect (taser) ──────────────────────────────────────────────────
function Lightning({ intensity, radius, height }: { intensity: number; radius: number; height: number }) {
  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  const lightRef = useRef<THREE.PointLight>(null);
  const spriteMat = useRef<THREE.SpriteMaterial>(null);
  const lastGen = useRef(0);
  const glowTex = useMemo(() => makeGlowTexture('#5cb4ff'), []);

  // White-hot core with an electric-blue glow (fixed — voltage changes shape, not color)
  const GLOW_BLUE = '#3ea8ff';

  // Shared materials for the multi-pass "thick line" rendering: WebGL ignores
  // line width, so the same geometry is drawn several times with tiny offsets.
  const coreMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), []);
  const glowMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: GLOW_BLUE, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), []);
  useEffect(
    () => () => { geom.dispose(); glowTex.dispose(); coreMaterial.dispose(); glowMaterial.dispose(); },
    [geom, glowTex, coreMaterial, glowMaterial],
  );

  // Every bolt is one unbroken path from the top terminal to the bottom one.
  // The arcs pinch at both ends and bulge outward through the middle, and the
  // wandering gets wilder (and the bolt count higher) as the voltage rises.
  const regenerate = useCallback(() => {
    const positions: number[] = [];
    const bolts = 2 + Math.round(intensity * 5);
    const halfH = height / 2;
    const maxR = radius * (0.55 + intensity * 0.55);
    const SEGS = 18;

    for (let b = 0; b < bolts; b++) {
      // Smooth per-bolt wander built from two random sine waves + point jitter
      const w1 = 1.5 + Math.random() * 2.5;
      const w2 = 4 + Math.random() * 4;
      const p1 = Math.random() * Math.PI * 2;
      const p2 = Math.random() * Math.PI * 2;
      const dir = Math.random() * Math.PI * 2; // main bulge direction
      const amp = 0.7 + Math.random() * 0.6;

      let px = 0, py = halfH, pz = 0;
      for (let i = 1; i <= SEGS; i++) {
        const f = i / SEGS;
        // Envelope: hugs the terminals tightly and bulges hard in the middle
        // (high exponent keeps the top/bottom compact instead of spreading early)
        const env = Math.pow(Math.sin(f * Math.PI), 2.4) * maxR * amp;
        const wander = Math.sin(f * Math.PI * w1 + p1) * 0.6 + Math.sin(f * Math.PI * w2 + p2) * 0.35;
        const jitter = (Math.random() - 0.5) * (0.45 + intensity * 0.75);
        const r = env * (wander + jitter);
        const x = Math.cos(dir) * r + env * (Math.random() - 0.5) * 0.4;
        const z = Math.sin(dir) * r + env * (Math.random() - 0.5) * 0.4;
        const y = halfH - f * height;
        positions.push(px, py, pz, x, y, z);
        px = x; py = y; pz = z;
      }
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.computeBoundingSphere();
  }, [geom, intensity, radius, height]);

  useFrame((state) => {
    const tMs = state.clock.elapsedTime * 1000;
    const interval = 120 - intensity * 85; // faster strikes at higher voltage
    if (tMs - lastGen.current > interval) {
      lastGen.current = tMs;
      regenerate();
    }
    const flick = 0.65 + Math.random() * 0.35;
    if (lightRef.current) lightRef.current.intensity = (3 + 12 * intensity) * flick;
    // Intentional three.js material mutation in the frame loop
    // eslint-disable-next-line react-hooks/immutability
    coreMaterial.opacity = (0.9 + intensity * 0.1) * flick;
    // eslint-disable-next-line react-hooks/immutability
    glowMaterial.opacity = (0.4 + intensity * 0.4) * flick;
    if (spriteMat.current) spriteMat.current.opacity = (0.22 + intensity * 0.55) * flick;
  });

  // Offset passes fake a fat, glowing stroke (core ~3px, halo wider)
  const d = radius * 0.045;
  const corePasses: [number, number][] = [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]];
  const glowPasses: [number, number][] = [
    [d * 2.2, 0], [-d * 2.2, 0], [0, d * 2.2], [0, -d * 2.2],
    [d * 1.6, d * 1.6], [-d * 1.6, -d * 1.6],
  ];

  return (
    <group>
      {corePasses.map(([ox, oz], i) => (
        <lineSegments key={`c${i}`} geometry={geom} material={coreMaterial} position={[ox, 0, oz]} />
      ))}
      {glowPasses.map(([ox, oz], i) => (
        <lineSegments key={`g${i}`} geometry={geom} material={glowMaterial} position={[ox, 0, oz]} />
      ))}
      <lineSegments geometry={geom} scale={[1.12, 1.0, 1.12]}>
        <lineBasicMaterial color={GLOW_BLUE} transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
      </lineSegments>
      <sprite scale={[radius * (2.4 + intensity * 2), height * 1.1, 1]}>
        <spriteMaterial ref={spriteMat} map={glowTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <pointLight ref={lightRef} color={GLOW_BLUE} distance={8} />
    </group>
  );
}

// ── Liquid effect (v1 / grenade / acid) ──────────────────────────────────────
function Liquid({ color, fill, radius, height }: { color: string; fill: number; radius: number; height: number }) {
  const bodyRef = useRef<THREE.Mesh>(null);
  const surfRef = useRef<THREE.Mesh>(null);
  const bubblesRef = useRef<THREE.InstancedMesh>(null);
  const BUBBLES = 26;

  const liquidH = Math.max(0.05, height * fill * 0.86);
  const bottomY = -height / 2 + height * 0.06;

  // Deterministic pseudo-random per bubble so render stays pure
  const bubbleSeeds = useMemo(
    () => Array.from({ length: BUBBLES }, (_, i) => {
      const h = (salt: number) => {
        const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
        return x - Math.floor(x);
      };
      return {
        a: h(1) * Math.PI * 2,
        r: h(2) * 0.8,
        speed: 0.25 + h(3) * 0.5,
        phase: h(4),
        size: 0.35 + h(5) * 0.75,
      };
    }),
    [],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Slosh: subtle tilt + bob
    if (bodyRef.current) {
      bodyRef.current.rotation.z = Math.sin(t * 1.6) * 0.045;
      bodyRef.current.rotation.x = Math.cos(t * 1.3) * 0.045;
    }
    if (surfRef.current) {
      surfRef.current.position.y = bottomY + liquidH + Math.sin(t * 2.2) * height * 0.008;
      surfRef.current.rotation.z = Math.sin(t * 1.6) * 0.05;
    }
    // Rising bubbles, wrapped inside the liquid volume
    if (bubblesRef.current) {
      for (let i = 0; i < BUBBLES; i++) {
        const s = bubbleSeeds[i];
        const y = ((s.phase + t * s.speed * 0.14) % 1) * liquidH;
        const wobble = Math.sin(t * 2 + i) * radius * 0.06;
        dummy.position.set(
          Math.cos(s.a) * s.r * radius * 0.6 + wobble,
          bottomY + y,
          Math.sin(s.a) * s.r * radius * 0.6,
        );
        const sc = radius * 0.06 * s.size * Math.min(1, (1 - y / Math.max(liquidH, 0.001)) + 0.55);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        bubblesRef.current.setMatrixAt(i, dummy.matrix);
      }
      bubblesRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {/* Liquid body */}
      <mesh ref={bodyRef} position={[0, bottomY + liquidH / 2, 0]}>
        <cylinderGeometry args={[radius * 0.78, radius * 0.78, liquidH, 28]} />
        <meshPhysicalMaterial
          color={color}
          transparent
          opacity={0.42}
          roughness={0.15}
          metalness={0}
          emissive={color}
          emissiveIntensity={0.35}
          depthWrite={false}
        />
      </mesh>
      {/* Glowing surface disc */}
      <mesh ref={surfRef} rotation-x={-Math.PI / 2} position={[0, bottomY + liquidH, 0]}>
        <circleGeometry args={[radius * 0.78, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
      {/* Bubbles */}
      <instancedMesh ref={bubblesRef} args={[undefined, undefined, BUBBLES]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>
      <pointLight color={color} intensity={1.4} distance={5} position={[0, bottomY + liquidH / 2, 0]} />
    </group>
  );
}

// ── Right canvas: designer cartridge preview ──────────────────────────────────
function DesignerCart({ type, voltage, fill, userSpinRef }: {
  type: CartTypeDef;
  voltage: number;
  fill: number;
  /** Accumulated user drag rotation (radians), consumed each frame */
  userSpinRef: React.MutableRefObject<number>;
}) {
  const cartGeom = useLoader(STLLoader, CART_URL);
  const spinRef = useRef<THREE.Group>(null);

  // The cart's long axis is already Y (three.js up) — just center it
  const { scale, center, inner } = useMemo(() => {
    cartGeom.computeBoundingBox();
    const bb = cartGeom.boundingBox!;
    const size = bb.getSize(new THREE.Vector3());
    const c = bb.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = 2.1 / maxDim;
    return {
      scale: s,
      center: c,
      inner: { radius: (Math.min(size.x, size.z) * s) / 2 * 0.78, height: size.y * s * 0.82 },
    };
  }, [cartGeom]);

  const shellMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: type.color,
    transparent: true,
    opacity: 0.22,
    roughness: 0.12,
    metalness: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), [type.color]);
  useEffect(() => () => shellMat.dispose(), [shellMat]);

  // Slow auto-spin plus whatever the user dragged since the last frame
  useFrame((_, delta) => {
    if (!spinRef.current) return;
    spinRef.current.rotation.y += delta * 0.45 + userSpinRef.current;
    userSpinRef.current = 0;
  });

  const intensity = (voltage - 100) / 300;

  return (
    <group ref={spinRef}>
      {/* Interior effect — vertically centered on the cart */}
      {type.id === 'taser'
        ? <Lightning intensity={intensity} radius={inner.radius} height={inner.height} />
        : <Liquid color={type.liquid ?? type.color} fill={fill} radius={inner.radius} height={inner.height} />}

      {/* Translucent shell rendered after the contents */}
      <group scale={scale}>
        <group position={[-center.x, -center.y, -center.z]}>
          <mesh geometry={cartGeom} material={shellMat} renderOrder={3} />
        </group>
      </group>

      {/* Base glow under the cart */}
      <mesh rotation-x={-Math.PI / 2} position-y={-inner.height / 1.55}>
        <ringGeometry args={[0.85, 0.9, 48]} />
        <meshBasicMaterial color={type.color} transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ── Voltage knob (100–400 kV) ─────────────────────────────────────────────────
// True rotary control: drag your finger AROUND the dial (like turning a real
// knob) — the needle follows the angular movement of the pointer.
function VoltageKnob({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const knobRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ lastAngle: number; v: number } | null>(null);
  const lastTick = useRef(Math.round(value / 10));

  const t = (value - 100) / 300;
  const angle = -135 + t * 270;

  // Pointer angle around the dial center, degrees, 0 = straight up, CW positive
  const angleAt = (e: React.PointerEvent) => {
    const rect = knobRef.current!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.atan2(e.clientX - cx, -(e.clientY - cy)) * (180 / Math.PI);
  };

  const setValue = (v: number) => {
    const clamped = Math.round(THREE.MathUtils.clamp(v, 100, 400));
    const tick = Math.round(clamped / 10);
    if (tick !== lastTick.current) {
      lastTick.current = tick;
      sfx('click', 0.22, 0.85 + ((clamped - 100) / 300) * 0.5);
    }
    onChange(clamped);
    return clamped;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    safeCapture(e.currentTarget as HTMLElement, e.pointerId);
    drag.current = { lastAngle: angleAt(e), v: value };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const a = angleAt(e);
    // Signed shortest angular delta since the last move (handles wrap-around)
    let d = a - drag.current.lastAngle;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    drag.current.lastAngle = a;
    // 270° of dial sweep = full 300 kV range
    drag.current.v = THREE.MathUtils.clamp(drag.current.v + (d / 270) * 300, 100, 400);
    setValue(drag.current.v);
  };
  const onPointerUp = () => { drag.current = null; };

  // Knob glows hotter with voltage
  const glowColor = t < 0.5 ? '#3ec6ff' : t < 0.8 ? '#9df3ff' : '#ffffff';

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        ref={knobRef}
        className="relative w-36 h-36 cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0">
          {/* Tick arc */}
          {Array.from({ length: 28 }, (_, i) => {
            const a = (-135 + (i / 27) * 270) * (Math.PI / 180);
            const on = i / 27 <= t;
            return (
              <line
                key={i}
                x1={50 + Math.sin(a) * 40} y1={50 - Math.cos(a) * 40}
                x2={50 + Math.sin(a) * 45} y2={50 - Math.cos(a) * 45}
                stroke={on ? glowColor : 'rgba(255,255,255,0.15)'}
                strokeWidth={on ? 2 : 1}
                style={on ? { filter: `drop-shadow(0 0 3px ${glowColor})` } : undefined}
              />
            );
          })}
          {/* Body */}
          <circle cx="50" cy="50" r="30" fill="rgba(8,16,28,0.9)" stroke={`${ACCENT_DIM}0.5)`} strokeWidth="1" />
          <circle cx="50" cy="50" r="30" fill="none" stroke={glowColor} strokeWidth="1.5" opacity={0.25 + t * 0.75}
            style={{ filter: `drop-shadow(0 0 ${4 + t * 10}px ${glowColor})` }} />
          {/* Needle */}
          <g transform={`rotate(${angle} 50 50)`}>
            <line x1="50" y1="50" x2="50" y2="26" stroke={glowColor} strokeWidth="2.5" strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${glowColor})` }} />
          </g>
          <circle cx="50" cy="50" r="4" fill={glowColor} opacity="0.9" />
        </svg>
        {/* Readout */}
        <div className="absolute inset-x-0 -bottom-1 text-center pointer-events-none">
          <span className="font-mono text-lg font-bold tabular-nums" style={{ color: glowColor, textShadow: `0 0 12px ${glowColor}` }}>
            {value}
          </span>
          <span className="font-mono text-[10px] text-white/40 ml-1">kV</span>
        </div>
      </div>
      <span className="font-mono text-[8px] uppercase tracking-[0.35em] text-white/35 mt-2">Discharge Voltage</span>
    </div>
  );
}

// ── Futuristic slider ─────────────────────────────────────────────────────────
function FuturisticSlider({ def, value, color, onChange }: {
  def: SliderDef;
  value: number;
  color: string;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const lastStep = useRef(Math.round((value / def.max) * 10));

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = THREE.MathUtils.clamp((clientX - rect.left) / rect.width, 0, 1);
    const v = Math.round(f * def.max);
    const step = Math.round(f * 10);
    if (step !== lastStep.current) {
      lastStep.current = step;
      sfx('click', 0.15, 1.1);
    }
    onChange(v);
  };

  const pct = (value / def.max) * 100;

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/55 w-32 shrink-0 truncate">{def.label}</span>
      <div
        ref={trackRef}
        className="relative flex-1 h-6 cursor-pointer"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          safeCapture(e.currentTarget as HTMLElement, e.pointerId);
          setDragging(true);
          setFromClientX(e.clientX);
        }}
        onPointerMove={(e) => { if (dragging) setFromClientX(e.clientX); }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        {/* Track */}
        <div
          className="absolute inset-y-2 inset-x-0"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
          }}
        />
        {/* Fill */}
        <div
          className="absolute inset-y-2 left-0"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}33, ${color})`,
            boxShadow: `0 0 10px ${color}88`,
            clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
            transition: dragging ? 'none' : 'width 0.15s',
          }}
        />
        {/* Segment ticks */}
        {[25, 50, 75].map((p) => (
          <div key={p} className="absolute inset-y-2 w-px bg-black/50" style={{ left: `${p}%` }} />
        ))}
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rotate-45 pointer-events-none"
          style={{
            left: `${pct}%`,
            background: '#0a1420',
            border: `1.5px solid ${color}`,
            boxShadow: `0 0 10px ${color}`,
            transition: dragging ? 'none' : 'left 0.15s',
          }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums w-14 text-right shrink-0" style={{ color }}>
        {value} <span className="text-white/30">{def.unit}</span>
      </span>
    </div>
  );
}

// ── Detonation switch ─────────────────────────────────────────────────────────
function DetonationSwitch({ armed, onToggle }: { armed: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      onClick={() => {
        if (armed) {
          sfx('click', 0.4);
        } else {
          sfx('switch_interface', 0.6);
          sfx('slide2', 0.4);
        }
        onToggle(!armed);
      }}
      className="w-full flex items-center justify-between px-4 py-3 transition-all"
      style={{
        background: armed ? 'rgba(255,77,77,0.10)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${armed ? DANGER : 'rgba(255,255,255,0.12)'}`,
        boxShadow: armed ? `0 0 24px ${DANGER}44, inset 0 0 18px ${DANGER}22` : 'none',
        clipPath: 'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
      }}
    >
      <div className="text-left">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: armed ? DANGER : 'rgba(255,255,255,0.7)' }}>
          Manual Detonation
        </div>
        <div className={`font-mono text-[8px] uppercase tracking-[0.25em] mt-0.5 ${armed ? 'animate-pulse' : ''}`}
          style={{ color: armed ? DANGER : 'rgba(255,255,255,0.3)' }}>
          {armed ? '⚠ Armed — trigger raised' : 'Safe'}
        </div>
      </div>
      {/* Slide toggle */}
      <div
        className="relative w-14 h-6 shrink-0"
        style={{
          background: armed ? `${DANGER}33` : 'rgba(255,255,255,0.08)',
          border: `1px solid ${armed ? DANGER : 'rgba(255,255,255,0.2)'}`,
          clipPath: 'polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)',
        }}
      >
        <div
          className="absolute top-0.5 bottom-0.5 w-6 transition-all duration-200"
          style={{
            left: armed ? 'calc(100% - 26px)' : '2px',
            background: armed ? DANGER : ACCENT,
            boxShadow: `0 0 10px ${armed ? DANGER : ACCENT}`,
            clipPath: 'polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%)',
          }}
        />
      </div>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function WebshooterPage({ onNavigateHome }: { onNavigateHome: () => void }) {
  const [typeIdx, setTypeIdx] = useState(0);
  const type = CART_TYPES[typeIdx];

  const [voltage, setVoltage] = useState(180);
  const [mixes, setMixes] = useState<Record<CartTypeId, Record<string, number>>>(() =>
    Object.fromEntries(
      CART_TYPES.map((t) => [t.id, Object.fromEntries(t.sliders.map((s) => [s.id, s.initial]))]),
    ) as Record<CartTypeId, Record<string, number>>,
  );
  const [armed, setArmed] = useState<Record<CartTypeId, boolean>>({ taser: false, v1: false, grenade: false, acid: false });
  const [slots, setSlots] = useState<(InstalledCart | null)[]>([null, null, null, null]);

  // Cart drag-install
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [hoverQuadrant, setHoverQuadrant] = useState<number | null>(null);
  const [formulaLabOpen, setFormulaLabOpen] = useState(false);
  const leftCanvasRef = useRef<HTMLDivElement>(null);

  // Live projected screen positions (normalized) of the 4 slots, fed by HoloBase
  const slotScreensRef = useRef<{ nx: number; ny: number }[]>([]);
  // User-controlled rotations
  const baseYawRef = useRef(0);
  const cartSpinRef = useRef(0);

  const buttonUp = armed.taser || armed.grenade;

  // Liquid fill fraction from the current mix totals
  const fill = useMemo(() => {
    if (type.sliders.length === 0) return 0.5;
    const total = type.sliders.reduce((sum, s) => sum + (mixes[type.id][s.id] ?? 0), 0);
    return THREE.MathUtils.clamp(total / (type.sliders.length * 100), 0.12, 0.95);
  }, [type, mixes]);

  const cycle = (dir: 1 | -1) => {
    sfx('switch_interface', 0.45);
    setTypeIdx((i) => (i + dir + CART_TYPES.length) % CART_TYPES.length);
  };

  // Nearest slot to the pointer, using live projected slot positions — this
  // stays accurate even while the base is spun around
  const quadrantAt = (clientX: number, clientY: number): number | null => {
    const el = leftCanvasRef.current;
    const screens = slotScreensRef.current;
    if (!el || screens.length !== 4) return null;
    const r = el.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const px = (clientX - r.left) / r.width;
    const py = (clientY - r.top) / r.height;
    let best: number | null = null;
    let bestD = Infinity;
    screens.forEach((s, i) => {
      if (s.nx < 0) return;
      const d = Math.hypot(s.nx - px, s.ny - py);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  // Drag anywhere on the base view to spin the hologram
  const beginBaseSpin = (e: React.PointerEvent) => {
    let lastX = e.clientX;
    const move = (ev: PointerEvent) => {
      baseYawRef.current += (ev.clientX - lastX) * 0.008;
      lastX = ev.clientX;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Drag on the cart preview to spin the cartridge
  const beginCartSpin = (e: React.PointerEvent) => {
    let lastX = e.clientX;
    const move = (ev: PointerEvent) => {
      cartSpinRef.current += (ev.clientX - lastX) * 0.012;
      lastX = ev.clientX;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const beginCartDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    sfx('select', 0.4);
    setDrag({ x: e.clientX, y: e.clientY });

    const move = (ev: PointerEvent) => {
      setDrag({ x: ev.clientX, y: ev.clientY });
      setHoverQuadrant(quadrantAt(ev.clientX, ev.clientY));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const q = quadrantAt(ev.clientX, ev.clientY);
      setDrag(null);
      setHoverQuadrant(null);
      if (q !== null) {
        sfx('select_confirm', 0.8);
        setSlots((prev) => {
          const next = [...prev];
          next[q] = { type: type.id, color: type.color, installedAt: Date.now() };
          return next;
        });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const ejectSlot = (i: number) => {
    sfx('app_close', 0.5);
    setSlots((prev) => {
      const next = [...prev];
      next[i] = null;
      return next;
    });
  };

  const setMix = (sliderId: string, v: number) => {
    setMixes((prev) => ({ ...prev, [type.id]: { ...prev[type.id], [sliderId]: v } }));
  };

  const loadedCount = slots.filter(Boolean).length;

  // Send the whole web-shooter assembly (base + button + loaded carts) to the
  // fabrication bay. All the STLs share one assembly coordinate space, so the
  // manufacturing page can render them together as-is.
  const startBuild = () => {
    sfx('select_confirm', 0.7);
    const parts = [
      { file: BASE_URL },
      { file: BUTTON_URL, align: 'center-top', extended: true }, // build with trigger out
      ...SLOT_FILES.flatMap((f, i) => (slots[i] ? [{ file: f.url, quad: f.quad }] : [])),
    ];
    window.dispatchEvent(new CustomEvent('jarvis:navigate', {
      detail: {
        page: 'manufacturing',
        buildModel: {
          file: BASE_URL,
          name: 'Web-Shooter Assembly',
          sub: `${loadedCount}/4 cartridges loaded`,
          parts,
        },
      },
    }));
  };

  return (
    <motion.div
      className="fixed inset-0 z-[50] overflow-hidden flex flex-col"
      style={{ background: '#020814' }}
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      {/* Ambient haze + dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 90% 60% at 30% 95%, rgba(14,80,160,0.28) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 0%, rgba(20,60,120,0.2) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: `radial-gradient(circle, ${ACCENT_DIM}0.12) 1px, transparent 1px)`, backgroundSize: '30px 30px' }}
      />

      <PageHeader title="Webshooter Designer" onNavigateHome={onNavigateHome} accent="cyan" />

      <div className="flex-1 flex min-h-0 relative z-10">
        {/* ── Left: holographic web-shooter base ── */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          <div className="absolute top-4 left-6 z-10 pointer-events-none">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.4em]" style={{ color: ACCENT }}>
              Web-Shooter Base
            </h2>
            <p className="font-mono text-[8px] uppercase tracking-[0.25em] text-white/30 mt-1">
              Holographic assembly · {loadedCount}/4 cartridges loaded
            </p>
            {buttonUp && (
              <p className="font-mono text-[9px] uppercase tracking-[0.3em] mt-2 animate-pulse" style={{ color: DANGER }}>
                ⚠ Detonation trigger raised
              </p>
            )}
          </div>

          <div
            ref={leftCanvasRef}
            className="flex-1 min-h-0 cursor-grab active:cursor-grabbing"
            style={{ touchAction: 'none' }}
            onPointerDown={beginBaseSpin}
          >
            <Canvas
              dpr={[1, 2]}
              camera={{ position: [0, 3.1, 4.4], fov: 42 }}
              gl={{ alpha: true, antialias: true }}
              onCreated={({ camera }) => camera.lookAt(0, 0.1, 0)}
            >
              <ambientLight intensity={0.5} color="#8ab4d8" />
              <Suspense fallback={null}>
                <HoloBase
                  armed={buttonUp}
                  slots={slots}
                  hoverQuadrant={hoverQuadrant}
                  yawRef={baseYawRef}
                  onSlotScreens={(s) => { slotScreensRef.current = s; }}
                  onEject={ejectSlot}
                />
              </Suspense>
            </Canvas>
          </div>

          <div className="absolute bottom-4 inset-x-0 flex justify-center pointer-events-none">
            <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/25">
              Drag to spin · {loadedCount > 0 ? 'Tap a loaded cartridge to eject' : 'Drop cartridges from the designer to load'}
            </span>
          </div>
        </div>

        {/* ── Right: web fluid designer (~1/3 screen) ── */}
        <div className="w-1/3 min-w-[380px] shrink-0 flex flex-col border-l" style={{ borderColor: `${ACCENT_DIM}0.12)` }}>
          {/* Cart type cycler */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: `${ACCENT_DIM}0.12)` }}>
            <button onClick={() => cycle(-1)} className="w-8 h-8 flex items-center justify-center font-mono text-lg transition-colors hover:text-white"
              style={{ color: ACCENT }}>
              ‹
            </button>
            <div className="text-center">
              <div className="font-mono text-[8px] uppercase tracking-[0.4em] text-white/30">Web Fluid Designer</div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={type.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  <div className="font-mono text-[13px] font-bold uppercase tracking-[0.3em] mt-0.5" style={{ color: type.color, textShadow: `0 0 14px ${type.color}88` }}>
                    {type.name}
                  </div>
                  <div className="font-mono text-[8px] uppercase tracking-[0.25em] text-white/30">{type.sub}</div>
                </motion.div>
              </AnimatePresence>
              <div className="flex justify-center gap-1.5 mt-1.5">
                {CART_TYPES.map((tt, i) => (
                  <span key={tt.id} className="w-1 h-1 rounded-full transition-all"
                    style={{ background: i === typeIdx ? tt.color : 'rgba(255,255,255,0.2)', boxShadow: i === typeIdx ? `0 0 6px ${tt.color}` : 'none' }} />
                ))}
              </div>
              {type.id === 'v1' && (
                <button
                  type="button"
                  onClick={() => { sfx('select', 0.4); setFormulaLabOpen(true); }}
                  className="mt-2 px-4 py-1.5 font-mono text-[9px] uppercase tracking-[0.35em]"
                  style={{
                    color: type.color,
                    border: `1px solid ${type.color}66`,
                    background: `${type.color}14`,
                    boxShadow: `0 0 14px ${type.color}22`,
                  }}
                >
                  Open Lab
                </button>
              )}
            </div>
            <button onClick={() => cycle(1)} className="w-8 h-8 flex items-center justify-center font-mono text-lg transition-colors hover:text-white"
              style={{ color: ACCENT }}>
              ›
            </button>
          </div>

          {/* Cart 3D preview — drag on it to spin, use the handle below to load */}
          <div
            className="relative shrink-0 cursor-grab active:cursor-grabbing"
            style={{ height: '34%', minHeight: 220, touchAction: 'none' }}
            onPointerDown={beginCartSpin}
          >
            <Canvas
              dpr={[1, 2]}
              camera={{ position: [0, 0.4, 3.4], fov: 40 }}
              gl={{ alpha: true, antialias: true }}
              onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
            >
              <ambientLight intensity={0.55} color="#8ab4d8" />
              <directionalLight position={[3, 5, 4]} intensity={0.9} />
              <Suspense fallback={null}>
                <DesignerCart type={type} voltage={voltage} fill={fill} userSpinRef={cartSpinRef} />
              </Suspense>
            </Canvas>
            <div className="absolute top-2 inset-x-0 flex justify-center pointer-events-none">
              <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-white/25">
                Drag to spin
              </span>
            </div>
            {/* Install handle */}
            <div className="absolute bottom-2 inset-x-0 flex justify-center">
              <button
                onPointerDown={(e) => { e.stopPropagation(); beginCartDrag(e); }}
                className="px-4 py-1.5 font-mono text-[9px] uppercase tracking-[0.3em] cursor-grab active:cursor-grabbing transition-colors"
                style={{
                  touchAction: 'none',
                  color: type.color,
                  border: `1px solid ${type.color}55`,
                  background: 'rgba(2,8,20,0.7)',
                  boxShadow: `0 0 14px ${type.color}33`,
                  clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)',
                }}
              >
                ⇠ Drag onto base to load
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 flex flex-col gap-4 border-t" style={{ borderColor: `${ACCENT_DIM}0.1)` }}>
            <AnimatePresence mode="wait">
              <motion.div
                key={type.id}
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-4"
              >
                {/* Taser: voltage knob */}
                {type.id === 'taser' && (
                  <div className="flex justify-center pt-2 pb-4">
                    <VoltageKnob value={voltage} onChange={setVoltage} />
                  </div>
                )}

                {/* Chemical sliders */}
                {type.sliders.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <div className="font-mono text-[8px] uppercase tracking-[0.35em] text-white/35">
                      Compound Mixture
                    </div>
                    {type.sliders.map((s) => (
                      <FuturisticSlider
                        key={s.id}
                        def={s}
                        value={mixes[type.id][s.id] ?? 0}
                        color={type.color}
                        onChange={(v) => setMix(s.id, v)}
                      />
                    ))}
                  </div>
                )}

                {/* Manual detonation */}
                {type.hasDetonator && (
                  <DetonationSwitch
                    armed={armed[type.id]}
                    onToggle={(v) => setArmed((prev) => ({ ...prev, [type.id]: v }))}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* BUILD — large action button, sitting left of the Jarvis ring */}
      <motion.button
        onClick={startBuild}
        className="absolute bottom-14 right-[240px] z-20 group select-none"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.4 }}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.97 }}
      >
        <div
          className="relative px-12 py-5"
          style={{
            background: 'linear-gradient(160deg, rgba(6,20,38,0.95) 0%, rgba(10,32,58,0.9) 100%)',
            border: `1px solid ${ACCENT}`,
            boxShadow: `0 0 30px ${ACCENT_DIM}0.35), inset 0 0 22px ${ACCENT_DIM}0.12)`,
            clipPath: 'polygon(18px 0, 100% 0, calc(100% - 18px) 100%, 0 100%)',
          }}
        >
          <span
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: `${ACCENT_DIM}0.12)` }}
          />
          <span
            className="relative font-mono text-xl font-bold uppercase tracking-[0.5em] pl-2"
            style={{ color: ACCENT, textShadow: `0 0 18px ${ACCENT}` }}
          >
            Build
          </span>
          <span className="relative block font-mono text-[8px] uppercase tracking-[0.3em] text-white/35 mt-1">
            Send assembly to fabrication
          </span>
        </div>
      </motion.button>

      {/* Drag ghost chip */}
      {drag && (
        <div
          className="fixed z-[60] pointer-events-none flex items-center gap-2 px-4 py-2"
          style={{
            left: drag.x,
            top: drag.y,
            transform: 'translate(-50%, -120%)',
            background: 'rgba(2,8,20,0.9)',
            border: `1px solid ${type.color}`,
            boxShadow: `0 0 24px ${type.color}66`,
            clipPath: 'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
          }}
        >
          <span className="w-2 h-2 rounded-full animate-ping" style={{ background: type.color }} />
          <span className="font-mono text-[10px] uppercase tracking-[0.25em]" style={{ color: type.color }}>
            {type.name} Cartridge
          </span>
        </div>
      )}

      <AnimatePresence>
        {formulaLabOpen && (
          <WebFluidFormulaLab key="web-fluid-lab" onClose={() => setFormulaLabOpen(false)} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
