'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { useGLTF, Html, Grid } from '@react-three/drei';
import { STLLoader } from 'three-stdlib';
import { motion, AnimatePresence } from 'framer-motion';
import * as THREE from 'three';
import { PageHeader } from '../PageHeader';
import { sfx } from '../../lib/sfx';

// ── Suit catalog ──────────────────────────────────────────────────────────────
const SUITS = [
  {
    file: '/models/SpiderMan/spider-man_-_homemade_suit_homecoming.glb',
    name: 'Homemade Suit',
    sub: 'Homecoming',
  },
  {
    file: '/models/SpiderMan/spider-man_2017_homecoming_-_tech_suit.glb',
    name: 'Tech Suit',
    sub: 'Stark Industries · Homecoming',
  },
  {
    file: '/models/SpiderMan/iron_spider_-_avengers_infinity_war.glb',
    name: 'Iron Spider',
    sub: 'Avengers: Infinity War',
  },
  {
    file: '/models/SpiderMan/andrew_garfield_amazing_spider-man_2.glb',
    name: 'Amazing Suit',
    sub: 'The Amazing Spider-Man 2',
  },
  {
    file: '/models/SpiderMan/spider-man_symbiote_spider-man_2_ps5_blend.glb',
    name: 'Symbiote Suit',
    sub: 'Marvel’s Spider-Man 2',
  },
  {
    file: '/models/SpiderMan/tung_tung_tung_sahur.glb',
    name: 'Tung Tung Tung Sahur',
    sub: 'Anomaly · Special Edition',
  },
];

// ── Accessory catalog (also consumed by the Manufacturing page) ───────────────
export const ACCESSORIES = [
  {
    file: '/models/SpiderMan/accessories/web_shooter_-_spider-man_2_ps5.glb',
    name: 'Web Shooter',
    sub: 'Marvel’s Spider-Man 2',
  },
  {
    file: '/models/SpiderMan/accessories/tasm_spiderman_web_shooters.glb',
    name: 'TASM Web Shooters',
    sub: 'The Amazing Spider-Man',
  },
  {
    file: '/models/SpiderMan/accessories/web_shooter_fanmade.glb',
    name: 'Web Shooter Mk II',
    sub: 'Concept Design',
  },
  {
    file: '/models/SpiderMan/accessories/webshooter_v4.glb',
    name: 'Web Shooter V4',
    sub: 'Prototype',
  },
  {
    file: '/models/SpiderMan/accessories/spider-man_web_shooter_design.glb',
    name: 'Shooter Design',
    sub: 'Engineering Study',
  },
  {
    file: '/models/SpiderMan/accessories/logo_spider-man.glb',
    name: 'Spider Emblem',
    sub: 'Chest Insignia',
  },
  {
    file: '/models/SpiderMan/accessories/spider-man_now_way_home_logo.glb',
    name: 'NWH Emblem',
    sub: 'No Way Home',
  },
  {
    file: '/models/SpiderMan/accessories/spider_logo3d.glb',
    name: 'Spider Logo 3D',
    sub: 'Emblem',
  },
  {
    file: '/models/SpiderMan/accessories/spider_man_logo.glb',
    name: 'Classic Logo',
    sub: 'Emblem',
  },
  {
    file: '/models/SpiderMan/accessories/Eyes.stl',
    name: 'Lens Assembly',
    sub: 'Optics · STL',
  },
];

type Category = 'suits' | 'accessories';
const CATALOG: Record<Category, typeof SUITS> = { suits: SUITS, accessories: ACCESSORIES };

const SPACING = 3.4;          // world units between podiums
const PX_PER_ITEM = 280;      // drag pixels to move one carousel slot
const SUIT_HEIGHT = 2.15;     // normalized suit height in world units
const ACCESSORY_SIZE = 1.5;   // normalized accessory max dimension
const ACCESSORY_Y = 1.12;     // hover height of an accessory's center
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

// ── Themes & settings ─────────────────────────────────────────────────────────
type RenderMode = 'solid' | 'wireframe' | 'hologram';
type ThemeKey = 'cyan' | 'blue' | 'red' | 'green' | 'purple' | 'gold';

interface ArmoryTheme {
  label: string;
  primary: string;   // main accent (rings, labels, holo)
  bright: string;    // brighter ring
  soft: string;      // dashed inner segments
  glow: [number, number, number]; // podium floor glow RGB
  grid: [string, string];         // floor grid cell / section
}

const THEMES: Record<ThemeKey, ArmoryTheme> = {
  cyan:   { label: 'Cyan',   primary: '#22d3ee', bright: '#7deeff', soft: '#a5f3fc', glow: [56, 220, 255],  grid: ['#0e4a66', '#155e75'] },
  blue:   { label: 'Blue',   primary: '#3b82f6', bright: '#7caeff', soft: '#bfdbfe', glow: [70, 140, 255],  grid: ['#12336e', '#1d4ed8'] },
  red:    { label: 'Red',    primary: '#f43f5e', bright: '#ff7d92', soft: '#fecdd3', glow: [255, 70, 100],  grid: ['#5c1424', '#881337'] },
  green:  { label: 'Green',  primary: '#34d399', bright: '#7dffce', soft: '#a7f3d0', glow: [60, 230, 160],  grid: ['#0d4a35', '#065f46'] },
  purple: { label: 'Purple', primary: '#a855f7', bright: '#c98aff', soft: '#e9d5ff', glow: [170, 90, 255],  grid: ['#3d1a66', '#6d28d9'] },
  gold:   { label: 'Gold',   primary: '#f59e0b', bright: '#ffc94d', soft: '#fde68a', glow: [255, 170, 40],  grid: ['#5c3c0a', '#92400e'] },
};

interface ArmorySettings {
  brightness: number;      // light multiplier 0.5–3
  mode: RenderMode;
  theme: ThemeKey;
  column: boolean;         // holographic light column around each suit
  holoDetail: number;      // 0–1, texture detail strength in hologram mode
}

const DEFAULT_SETTINGS: ArmorySettings = {
  brightness: 1.5,
  mode: 'solid',
  theme: 'cyan',
  column: false,
  holoDetail: 0.7,
};

const SETTINGS_KEY = 'jarvis_armory_settings';

function loadSettings(): ArmorySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* corrupted — fall back */ }
  return DEFAULT_SETTINGS;
}

// Mutable carousel state shared between DOM pointer handlers and the R3F frame loop
interface CarouselState {
  scroll: number;              // continuous position, in index units
  target: number;              // snap target index
  dragging: boolean;
  focused: number | null;      // item in inspect mode
  spinVel: number;             // inertial spin (rad/sec) for a focused suit (Y only)
  rotations: number[];         // per-suit manual Y rotation
  quats: THREE.Quaternion[];   // per-accessory free orientation (any axis)
  spinAxis: THREE.Vector3;     // accessory inertial tumble axis (world space)
  spinSpeed: number;           // accessory inertial tumble speed (rad/sec)
  zoom: number;                // focused-item zoom (pinch / scroll), 1 = default
  exiting: boolean;            // category switch: fly-out phase in progress
}

function makeCarouselState(count: number): CarouselState {
  return {
    scroll: 0,
    target: 0,
    dragging: false,
    focused: null,
    spinVel: 0,
    rotations: Array(count).fill(0),
    quats: Array.from({ length: count }, () => new THREE.Quaternion()),
    spinAxis: new THREE.Vector3(0, 1, 0),
    spinSpeed: 0,
    zoom: 1,
    exiting: false,
  };
}

const IDENTITY_QUAT = new THREE.Quaternion();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;

// ── Podium glow texture (radial gradient, rebuilt per theme) ─────────────────
function makeGlowTexture(rgb: [number, number, number]): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const [r, g, b] = rgb;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
  grad.addColorStop(0.35, `rgba(${r},${g},${b},0.35)`);
  grad.addColorStop(0.7, `rgba(${r},${g},${b},0.10)`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ── Hologram material: fresnel contour glow + drifting scanlines ─────────────
// Includes three's skinning chunks so SkinnedMesh suits keep their pose
// (without them the GPU gets raw bind-pose vertices).
const HOLO_VERTEX = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;
  varying vec2 vUv;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    vNormal = normalize(normalMatrix * objectNormal);
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;
    vUv = uv;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const HOLO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform float uDetail;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;
  varying vec2 vUv;
  void main() {
    // Fresnel: faces pointing away from camera glow — produces contour outlines
    float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.2);
    // Slow upward-drifting scanlines
    float scan = 0.82 + 0.18 * sin(vWorldY * 46.0 - uTime * 2.4);

    // Texture detail: eyes/logos/web lines are painted in the diffuse map, not
    // modeled. Sample its luminance and boost anything that deviates from the
    // suit's mid-tone — bright lenses glow, dark emblems become dim cutouts.
    float lum = dot(texture2D(uMap, vUv).rgb, vec3(0.299, 0.587, 0.114));
    float contrast = clamp((lum - 0.45) * 2.2 + 0.5, 0.0, 1.0);
    float detail = uHasMap * uDetail;
    float deviation = abs(contrast - 0.5) * 2.0;

    float alpha = (0.04 + 1.1 * fres + 0.55 * detail * deviation) * scan * uIntensity;
    vec3 col = uColor * (0.3 + fres * 2.2 + 1.6 * detail * contrast * contrast) * scan;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// True GLB materials, recorded the first time any mount sees each mesh.
// useGLTF caches scenes globally per URL, so this must be module-level: an
// instance-local map would record whatever materials the PREVIOUS mount left
// on the shared scene (e.g. hologram shaders), poisoning every later mount —
// that's why holo textures only appeared on the first-ever visit.
const TRUE_ORIGINALS = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();

// 1x1 white fallback so the sampler is always bound (uHasMap gates its effect)
let whiteTexture: THREE.Texture | null = null;
function getWhiteTexture(): THREE.Texture {
  if (!whiteTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 1, 1);
    whiteTexture = new THREE.CanvasTexture(c);
  }
  return whiteTexture;
}

function makeHologramMaterial(
  color: THREE.Color,
  intensity: number,
  map: THREE.Texture | null,
  detail: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uMap: { value: map ?? getWhiteTexture() },
      uHasMap: { value: map ? 1 : 0 },
      uDetail: { value: detail },
    },
    vertexShader: HOLO_VERTEX,
    fragmentShader: HOLO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// ── Futuristic ring podium ────────────────────────────────────────────────────
function RingPodium({ active, theme, showColumn }: { active: boolean; theme: ArmoryTheme; showColumn: boolean }) {
  const dashOuter = useRef<THREE.Group>(null);
  const dashInner = useRef<THREE.Group>(null);
  const glowTex = useMemo(() => makeGlowTexture(theme.glow), [theme]);

  useFrame((_, delta) => {
    if (dashOuter.current) dashOuter.current.rotation.y += delta * (active ? 0.9 : 0.45);
    if (dashInner.current) dashInner.current.rotation.y -= delta * (active ? 0.6 : 0.3);
  });

  return (
    <group>
      {/* Floor glow disc */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.005}>
        <circleGeometry args={[1.6, 48]} />
        <meshBasicMaterial
          map={glowTex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={active ? 1 : 0.5}
        />
      </mesh>

      {/* Solid main ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <ringGeometry args={[0.96, 1.03, 72]} />
        <meshBasicMaterial
          color={theme.bright}
          transparent
          opacity={active ? 1 : 0.7}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Rotating dashed segments — outer */}
      <group ref={dashOuter}>
        {Array.from({ length: 8 }).map((_, k) => (
          <mesh key={k} rotation-x={-Math.PI / 2} position-y={0.02}>
            <ringGeometry args={[1.12, 1.17, 24, 1, (k * Math.PI) / 4, Math.PI / 5.6]} />
            <meshBasicMaterial
              color={theme.primary}
              transparent
              opacity={active ? 0.9 : 0.5}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>

      {/* Rotating dashed segments — inner, counter-rotating */}
      <group ref={dashInner}>
        {Array.from({ length: 3 }).map((_, k) => (
          <mesh key={k} rotation-x={-Math.PI / 2} position-y={0.02}>
            <ringGeometry args={[0.82, 0.86, 24, 1, (k * 2 * Math.PI) / 3, Math.PI / 2.2]} />
            <meshBasicMaterial
              color={theme.soft}
              transparent
              opacity={active ? 0.7 : 0.35}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      </group>

      {/* Faint holographic light column (optional) */}
      {showColumn && (
        <mesh position-y={SUIT_HEIGHT / 2}>
          <cylinderGeometry args={[1.0, 1.0, SUIT_HEIGHT, 48, 1, true]} />
          <meshBasicMaterial
            color={theme.primary}
            transparent
            opacity={active ? 0.055 : 0.028}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Up-light from the podium */}
      <pointLight
        position={[0, 0.5, 0.6]}
        intensity={active ? 7 : 3}
        color={theme.primary}
        distance={6}
        decay={2}
      />
    </group>
  );
}

// ── Placeholder shown while a GLB streams in ─────────────────────────────────
function LoadingSuit({ theme, accessory = false }: { theme: ArmoryTheme; accessory?: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  // Accessories render inside a group already lifted to hover height
  const yCenter = accessory ? 0 : SUIT_HEIGHT / 2;
  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const t = clock.getElapsedTime();
    (mesh.current.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.1 * Math.sin(t * 3);
    mesh.current.rotation.y = t * 0.5;
  });
  return (
    <group>
      <mesh ref={mesh} position-y={yCenter}>
        {accessory
          ? <sphereGeometry args={[ACCESSORY_SIZE * 0.45, 12, 8]} />
          : <cylinderGeometry args={[0.32, 0.48, SUIT_HEIGHT * 0.92, 12, 6, true]} />}
        <meshBasicMaterial color={theme.primary} wireframe transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <Html center position={[0, yCenter, 0]} zIndexRange={[10, 0]}>
        <div
          className="font-mono text-[9px] uppercase tracking-[0.3em] whitespace-nowrap animate-pulse select-none pointer-events-none"
          style={{ color: theme.primary }}
        >
          Materializing…
        </div>
      </Html>
    </group>
  );
}

// Some suit GLBs are game rips that bundle weapon/web prop meshes alongside the
// body (e.g. "Kingpin_wp02", "spider_wp003", material "SpiderMan_web02").
// They hang around the character and wreck the bounding box, so hide them.
// GLTFLoader keeps generic node names ("Object_121") but preserves material
// names, so match both.
// "IronSpiderman02" is the Iron Spider's detached mech-leg rig, parked ~50
// units under the body in the default pose — unusable without its animations.
const PROP_NAME_RE = /kingpin|_wp\d|^wp\d|web\d|_skill|ironspiderman02/i;

function hidePropMeshes(scene: THREE.Object3D): void {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const matNames = mats.map((mm) => mm?.name ?? '').join(' ');
    if (PROP_NAME_RE.test(o.name) || PROP_NAME_RE.test(matNames)) {
      m.visible = false;
    }
  });
}

// Bounding box of VISIBLE meshes only, respecting skinned meshes:
// Box3.setFromObject uses the bind pose for SkinnedMesh, which can be wildly
// offset (e.g. the Iron Spider's mech legs sit 50 units away in bind pose).
// Update each skeleton to the current pose first, then measure posed bounds.
function computeSceneBox(scene: THREE.Object3D): THREE.Box3 {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh || !m.visible) return;
    if (m.isSkinnedMesh) {
      m.skeleton.update();
      m.computeBoundingBox();
      if (m.boundingBox) tmp.copy(m.boundingBox).applyMatrix4(m.matrixWorld);
      else return;
    } else {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if (!m.geometry.boundingBox) return;
      tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    }
    box.union(tmp);
  });
  return box;
}

// ── Model loading: GLB via the drei cache, STL built into a lit mesh ─────────
interface ModelVisualProps {
  mode: RenderMode;
  theme: ArmoryTheme;
  brightness: number;
  holoDetail: number;
  accessory?: boolean;
}

/** Dispatches on file extension so both formats share one carousel slot API. */
function SuitModel({ url, ...rest }: ModelVisualProps & { url: string }) {
  return url.toLowerCase().endsWith('.stl')
    ? <StlSuitModel url={url} {...rest} />
    : <GltfSuitModel url={url} {...rest} />;
}

function GltfSuitModel({ url, ...rest }: ModelVisualProps & { url: string }) {
  const { scene } = useGLTF(url);
  return <NormalizedModel scene={scene} {...rest} />;
}

function StlSuitModel({ url, ...rest }: ModelVisualProps & { url: string }) {
  const geometry = useLoader(STLLoader, url);
  // STL is bare geometry — wrap it in a printable-looking gray resin material
  const scene = useMemo(() => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: '#b8bcc4', metalness: 0.25, roughness: 0.45 }),
    );
    // STL exports are commonly Z-up; rotate to three.js Y-up
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
    return group;
  }, [geometry]);
  return <NormalizedModel scene={scene} {...rest} />;
}

// ── Normalization + render modes, shared by both formats ─────────────────────
// Suits: scaled by height, feet on the podium. Accessories: scaled by max
// dimension and centered so they hover mid-air and tumble around their center.
function NormalizedModel({ scene, mode, theme, brightness, holoDetail, accessory = false }: ModelVisualProps & {
  scene: THREE.Object3D;
}) {
  const grow = useRef(0);
  const outer = useRef<THREE.Group>(null);
  const holoMats = useRef<THREE.ShaderMaterial[]>([]);

  const { scale, offset } = useMemo(() => {
    // The prop filter hides "web*" meshes — that would erase the web shooters
    // themselves, so it only applies to suit models.
    if (!accessory) hidePropMeshes(scene);
    const box = computeSceneBox(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (accessory) {
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const s = ACCESSORY_SIZE / maxDim;
      return { scale: s, offset: [-center.x, -center.y, -center.z] as const };
    }
    const s = SUIT_HEIGHT / (size.y || 1);
    return { scale: s, offset: [-center.x, -box.min.y, -center.z] as const };
  }, [scene, accessory]);

  // Apply render-mode material overrides
  useEffect(() => {
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });

    // Record each mesh's true GLB material the first time it's ever seen
    for (const m of meshes) {
      if (!TRUE_ORIGINALS.has(m)) TRUE_ORIGINALS.set(m, m.material);
    }

    const created: THREE.Material[] = [];
    holoMats.current = [];
    const color = new THREE.Color(theme.primary);

    for (const m of meshes) {
      if (mode === 'solid') {
        const orig = TRUE_ORIGINALS.get(m);
        if (orig) m.material = orig;
      } else if (mode === 'wireframe') {
        const mat = new THREE.MeshBasicMaterial({
          color,
          wireframe: true,
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        created.push(mat);
        m.material = mat;
      } else {
        // Reuse the GLB's diffuse map so painted detail (eyes, logos, web
        // lines) survives the hologram conversion
        const orig = TRUE_ORIGINALS.get(m);
        const firstOrig = Array.isArray(orig) ? orig[0] : orig;
        const map = (firstOrig as THREE.MeshStandardMaterial | undefined)?.map ?? null;
        const mat = makeHologramMaterial(color, Math.min(brightness, 2), map, holoDetail);
        created.push(mat);
        holoMats.current.push(mat);
        m.material = mat;
      }
    }

    return () => {
      // The scene is a shared useGLTF cache entry: hand the true materials
      // back before disposing the overrides, or the next mount would find
      // (and clone detail from) dead hologram shaders.
      for (const m of meshes) {
        const orig = TRUE_ORIGINALS.get(m);
        if (orig) m.material = orig;
      }
      for (const mat of created) mat.dispose();
    };
  }, [scene, mode, theme, brightness, holoDetail]);

  useFrame((state, delta) => {
    // Materialize: quick scale-up when the model finishes loading
    if (outer.current && grow.current < 1) {
      grow.current = Math.min(1, grow.current + delta / 0.5);
      outer.current.scale.setScalar(easeOutCubic(grow.current));
    }
    // Animate hologram scanlines. Mutating uniforms inside the R3F frame
    // loop is the intended three.js pattern, not a React state violation.
    for (const mat of holoMats.current) {
      // eslint-disable-next-line react-hooks/immutability
      mat.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <group ref={outer} scale={0}>
      <group scale={scale}>
        <group position={offset}>
          <primitive object={scene} />
        </group>
      </group>
    </group>
  );
}

// ── One carousel slot: podium + model + label, positioned every frame ────────
interface SlotProps {
  index: number;
  item: { file: string; name: string; sub: string };
  accessory: boolean;
  stateRef: React.MutableRefObject<CarouselState>;
  onSuitClick: (i: number) => void;
  uiActive: boolean;
  settings: ArmorySettings;
}

function SuitSlot({ index, item, accessory, stateRef, onSuitClick, uiActive, settings }: SlotProps) {
  const group = useRef<THREE.Group>(null);
  const spinGroup = useRef<THREE.Group>(null);
  const intro = useRef({ t: 0, delay: 0.3 + index * 0.35 });
  const exit = useRef({ t: 0, delay: index * 0.04, fromX: 0 });
  const theme = THEMES[settings.theme];

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const s = stateRef.current;

    // Category switch: accelerate off-stage to the right, staggered
    if (s.exiting) {
      const ex = exit.current;
      if (ex.t === 0) ex.fromX = g.position.x;
      if (ex.delay > 0) {
        ex.delay -= delta;
        return;
      }
      ex.t = Math.min(1, ex.t + delta / 0.35);
      const e = ex.t * ex.t * ex.t; // ease-in cubic
      g.position.x = THREE.MathUtils.lerp(ex.fromX, 30, e);
      return;
    }

    // Target transform from carousel state
    const rel = index - s.scroll;
    let x = rel * SPACING;
    let z = -Math.abs(rel) * 1.5;
    let scale = clamp(1.12 - Math.abs(rel) * 0.3, 0.4, 1.12);

    if (s.focused !== null) {
      if (s.focused === index) {
        x = 0;
        z = 2.4;
        scale = 1.55 * s.zoom;
      } else {
        const relF = index - s.focused;
        x = relF * SPACING * 1.8;
        z = -3.4;
        scale = 0.45;
      }
    }

    // Intro: file in from far left, staggered left→right
    const it = intro.current;
    if (it.t < 1) {
      if (it.delay > 0) {
        it.delay -= delta;
        g.position.set(-26, 0, z);
        g.scale.setScalar(scale);
        return;
      }
      it.t = Math.min(1, it.t + delta / 1.1);
      const e = easeOutCubic(it.t);
      g.position.x = THREE.MathUtils.lerp(-26, x, e);
      g.position.z = z;
      g.scale.setScalar(scale);
    } else {
      const lam = 8;
      g.position.x = damp(g.position.x, x, lam, delta);
      g.position.z = damp(g.position.z, z, lam, delta);
      const cur = damp(g.scale.x, scale, lam, delta);
      g.scale.setScalar(cur);
    }

    // Manual / inertial spin — suits stay upright (Y only), accessories tumble freely
    if (spinGroup.current) {
      if (accessory) spinGroup.current.quaternion.copy(s.quats[index]);
      else spinGroup.current.rotation.y = s.rotations[index];
    }
  });

  return (
    <group ref={group} position={[-26, 0, 0]}>
      {/* Click target — invisible pillar covering the model */}
      <mesh
        position-y={SUIT_HEIGHT / 2}
        visible={false}
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta < 8) onSuitClick(index);
        }}
      >
        <cylinderGeometry args={[1.0, 1.0, SUIT_HEIGHT + 0.4, 12]} />
      </mesh>

      <RingPodium active={uiActive} theme={theme} showColumn={settings.column} />

      {/* Accessories hover above the podium and rotate around their center */}
      <group position-y={accessory ? ACCESSORY_Y : 0}>
        <group ref={spinGroup}>
          <Suspense fallback={<LoadingSuit theme={theme} accessory={accessory} />}>
            <SuitModel
              url={item.file}
              mode={settings.mode}
              theme={theme}
              brightness={settings.brightness}
              holoDetail={settings.holoDetail}
              accessory={accessory}
            />
          </Suspense>
        </group>
      </group>

      {/* Name plate */}
      <Html center position={[0, -0.12, 1.7]} zIndexRange={[10, 0]}>
        <div
          className="flex flex-col items-center select-none pointer-events-none whitespace-nowrap"
          style={{ opacity: uiActive ? 1 : 0.45, transition: 'opacity 0.4s' }}
        >
          <span
            className="font-mono text-[10px] uppercase tracking-[0.3em]"
            style={{ color: theme.primary, textShadow: `0 0 12px ${theme.primary}` }}
          >
            {item.name}
          </span>
        </div>
      </Html>
    </group>
  );
}

// ── Frame-loop rig: snapping, inertia, auto-spin ──────────────────────────────
const tmpQuat = new THREE.Quaternion();

function CarouselRig({ stateRef, accessory }: {
  stateRef: React.MutableRefObject<CarouselState>;
  accessory: boolean;
}) {
  useFrame((_, delta) => {
    const s = stateRef.current;
    if (s.exiting) return;

    // Snap the carousel toward its target when not dragging
    if (!s.dragging && s.focused === null) {
      s.scroll = damp(s.scroll, s.target, 7, delta);
    }
    if (s.focused !== null) {
      // Keep scroll aligned under the focused item for a clean exit
      s.scroll = damp(s.scroll, s.focused, 7, delta);
    }

    if (s.focused !== null && !s.dragging) {
      if (accessory) {
        // Free tumble inertia around the last drag axis + slow idle Y spin
        const q = s.quats[s.focused];
        if (s.spinSpeed > 0.01) {
          tmpQuat.setFromAxisAngle(s.spinAxis, s.spinSpeed * delta);
          q.premultiply(tmpQuat);
          s.spinSpeed = damp(s.spinSpeed, 0, 2.5, delta);
        } else {
          tmpQuat.setFromAxisAngle(Y_AXIS, delta * 0.25);
          q.premultiply(tmpQuat);
        }
      } else {
        // Suits stay upright: inertia + slow auto-rotate on Y only
        s.rotations[s.focused] += s.spinVel * delta + delta * 0.25;
        s.spinVel = damp(s.spinVel, 0, 2.5, delta);
      }
    }

    // Zoom eases back to default when nothing is focused
    if (s.focused === null) s.zoom = damp(s.zoom, 1, 6, delta);

    // Unfocused items ease back to their resting orientation
    const count = accessory ? s.quats.length : s.rotations.length;
    for (let i = 0; i < count; i++) {
      if (i === s.focused) continue;
      if (accessory) {
        if (s.quats[i].angleTo(IDENTITY_QUAT) > 0.001) {
          s.quats[i].slerp(IDENTITY_QUAT, 1 - Math.exp(-4 * delta));
        }
      } else {
        s.rotations[i] = damp(s.rotations[i], 0, 4, delta);
      }
    }
  });
  return null;
}

// ── Settings panel ────────────────────────────────────────────────────────────
function SettingsPanel({ settings, onChange }: {
  settings: ArmorySettings;
  onChange: (patch: Partial<ArmorySettings>) => void;
}) {
  const theme = THEMES[settings.theme];

  const modeButton = (mode: RenderMode, label: string) => (
    <button
      key={mode}
      onClick={() => onChange({ mode })}
      className="flex-1 py-1.5 font-mono text-[9px] uppercase tracking-widest transition-colors rounded"
      style={{
        color: settings.mode === mode ? '#fff' : 'rgba(255,255,255,0.35)',
        background: settings.mode === mode ? `${theme.primary}33` : 'transparent',
        border: `1px solid ${settings.mode === mode ? theme.primary : 'rgba(255,255,255,0.1)'}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.25 }}
      className="absolute top-14 right-4 z-20 w-64 rounded-xl p-4 flex flex-col gap-4"
      style={{
        background: 'rgba(2,8,20,0.88)',
        border: `1px solid ${theme.primary}44`,
        backdropFilter: 'blur(18px)',
        boxShadow: `0 8px 40px rgba(0,0,0,0.6), 0 0 24px ${theme.primary}22`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {/* Brightness */}
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between font-mono text-[9px] uppercase tracking-widest text-white/45">
          <span>Brightness</span>
          <span style={{ color: theme.primary }}>{Math.round(settings.brightness * 100)}%</span>
        </div>
        <input
          type="range"
          min={50}
          max={300}
          step={10}
          value={Math.round(settings.brightness * 100)}
          onChange={(e) => onChange({ brightness: Number(e.target.value) / 100 })}
          className="w-full h-1 cursor-pointer"
          style={{ accentColor: theme.primary }}
        />
      </div>

      {/* Render mode */}
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-widest text-white/45">Render Mode</span>
        <div className="flex gap-1.5">
          {modeButton('solid', 'Solid')}
          {modeButton('wireframe', 'Wire')}
          {modeButton('hologram', 'Holo')}
        </div>
      </div>

      {/* Holo detail (only relevant in hologram mode) */}
      {settings.mode === 'hologram' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between font-mono text-[9px] uppercase tracking-widest text-white/45">
            <span>Holo Detail</span>
            <span style={{ color: theme.primary }}>{Math.round(settings.holoDetail * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(settings.holoDetail * 100)}
            onChange={(e) => onChange({ holoDetail: Number(e.target.value) / 100 })}
            className="w-full h-1 cursor-pointer"
            style={{ accentColor: theme.primary }}
          />
        </div>
      )}

      {/* Theme */}
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[9px] uppercase tracking-widest text-white/45">Color Theme</span>
        <div className="flex gap-2">
          {(Object.keys(THEMES) as ThemeKey[]).map((key) => (
            <button
              key={key}
              onClick={() => onChange({ theme: key })}
              aria-label={`${THEMES[key].label} theme`}
              className="w-6 h-6 rounded-full transition-transform hover:scale-110"
              style={{
                background: THEMES[key].primary,
                border: settings.theme === key ? '2px solid #fff' : '2px solid transparent',
                boxShadow: settings.theme === key ? `0 0 10px ${THEMES[key].primary}` : 'none',
              }}
            />
          ))}
        </div>
      </div>

      {/* Holo chamber toggle */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-widest text-white/45">Holo Chamber</span>
        <button
          onClick={() => onChange({ column: !settings.column })}
          className="relative w-10 h-5 rounded-full transition-colors"
          style={{
            background: settings.column ? `${theme.primary}55` : 'rgba(255,255,255,0.1)',
            border: `1px solid ${settings.column ? theme.primary : 'rgba(255,255,255,0.15)'}`,
          }}
          aria-label="Toggle holo chamber"
        >
          <div
            className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all"
            style={{
              left: settings.column ? 'calc(100% - 18px)' : '2px',
              background: settings.column ? theme.primary : 'rgba(255,255,255,0.4)',
              boxShadow: settings.column ? `0 0 8px ${theme.primary}` : 'none',
            }}
          />
        </button>
      </div>
    </motion.div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
interface Props {
  onNavigateHome: () => void;
}

export function SpidermanPage({ onNavigateHome }: Props) {
  const stateRef = useRef<CarouselState>(makeCarouselState(SUITS.length));

  const [category, setCategory] = useState<Category>('suits');
  const [switching, setSwitching] = useState(false);
  const [uiSelected, setUiSelected] = useState(0);
  const [uiFocused, setUiFocused] = useState<number | null>(null);
  const [settings, setSettings] = useState<ArmorySettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);

  const items = CATALOG[category];
  const count = items.length;
  const isAccessory = category === 'accessories';

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }, [settings]);

  const patchSettings = useCallback((patch: Partial<ArmorySettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const drag = useRef({
    active: false, startX: 0, lastX: 0, lastY: 0, lastT: 0,
    moved: 0, vel: 0, velY: 0, startScroll: 0,
  });
  // Multi-pointer tracking for pinch-to-zoom
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef({ active: false, startDist: 0, startZoom: 1 });

  // Category switch: fly the current lineup out, then mount the new one
  // (fresh keys restart the staggered intro animation).
  const switchCategory = useCallback((next: Category) => {
    if (next === category || switching) return;
    setSwitching(true);
    setShowSettings(false);
    stateRef.current.exiting = true;
    stateRef.current.focused = null;
    setUiFocused(null);
    window.setTimeout(() => {
      stateRef.current = makeCarouselState(CATALOG[next].length);
      setCategory(next);
      setUiSelected(0);
      setSwitching(false);
    }, 750);
  }, [category, switching]);

  const selectSuit = useCallback((i: number, focus: boolean) => {
    const s = stateRef.current;
    const idx = clamp(i, 0, count - 1);
    s.target = idx;
    setUiSelected(idx);
    if (focus) {
      s.focused = idx;
      setUiFocused(idx);
    }
  }, [count]);

  const unfocus = useCallback(() => {
    stateRef.current.focused = null;
    stateRef.current.spinVel = 0;
    stateRef.current.spinSpeed = 0;
    setUiFocused(null);
  }, []);

  const onSuitClick = useCallback(
    (i: number) => {
      if (stateRef.current.focused === i) unfocus();
      else selectSuit(i, true);
    },
    [selectSuit, unfocus]
  );

  // Pointer handlers: swipe to browse, drag to spin when inspecting,
  // two-finger pinch to zoom the inspected item
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      // Second finger down → switch from drag to pinch
      const [a, b2] = [...pointers.current.values()];
      pinch.current = {
        active: true,
        startDist: Math.hypot(b2.x - a.x, b2.y - a.y) || 1,
        startZoom: stateRef.current.zoom,
      };
      drag.current.active = false;
      stateRef.current.dragging = false;
      return;
    }
    if (pinch.current.active) return;

    const d = drag.current;
    d.active = true;
    d.startX = d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = performance.now();
    d.moved = 0;
    d.vel = 0;
    d.velY = 0;
    d.startScroll = stateRef.current.scroll;
    stateRef.current.dragging = true;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = stateRef.current;

    if (pinch.current.active) {
      const p = pointers.current.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (pointers.current.size >= 2 && s.focused !== null) {
        const [a, b2] = [...pointers.current.values()];
        const dist = Math.hypot(b2.x - a.x, b2.y - a.y) || 1;
        s.zoom = clamp(pinch.current.startZoom * (dist / pinch.current.startDist), MIN_ZOOM, MAX_ZOOM);
      }
      return;
    }

    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    const now = performance.now();
    const dt = Math.max(now - d.lastT, 1);
    d.vel = dx / dt;  // px per ms
    d.velY = dy / dt;
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = now;

    if (s.focused !== null) {
      if (isAccessory) {
        // Trackball: horizontal drag spins around world Y, vertical around
        // world X — combined they rotate the piece in any direction.
        tmpQuat.setFromEuler(new THREE.Euler(dy * 0.01, dx * 0.01, 0, 'XYZ'));
        s.quats[s.focused].premultiply(tmpQuat);
      } else {
        s.rotations[s.focused] += dx * 0.012;
      }
    } else {
      s.scroll = clamp(d.startScroll - (e.clientX - d.startX) / PX_PER_ITEM, -0.35, count - 0.65);
    }
  }, [isAccessory, count]);

  const endDrag = useCallback((e?: React.PointerEvent) => {
    if (e) pointers.current.delete(e.pointerId);
    else pointers.current.clear();

    if (pinch.current.active) {
      if (pointers.current.size < 2) {
        pinch.current.active = false;
        // Swallow the remaining finger so lifting it doesn't fling the model
        pointers.current.clear();
      }
      return;
    }

    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    const s = stateRef.current;
    s.dragging = false;

    if (s.focused !== null) {
      if (isAccessory) {
        // Convert fling velocity into a world-space tumble axis + speed
        const speed = clamp(Math.hypot(d.vel, d.velY) * 1000 * 0.01, 0, 12);
        if (speed > 0.3) {
          s.spinAxis.set(d.velY, d.vel, 0).normalize();
          s.spinSpeed = speed;
        }
      } else {
        // Fling inertia (rad/sec), clamped so it doesn't spin forever
        s.spinVel = clamp(d.vel * 1000 * 0.012, -12, 12);
      }
    } else if (d.moved > 6) {
      const predicted = s.scroll - (d.vel * 220) / PX_PER_ITEM;
      const idx = clamp(Math.round(predicted), 0, count - 1);
      s.target = idx;
      setUiSelected(idx);
    }
  }, [isAccessory, count]);

  // Scroll / trackpad-pinch zoom while inspecting (the Electron touch film
  // translates two-finger pinches into wheel events too)
  const onWheel = useCallback((e: React.WheelEvent) => {
    const s = stateRef.current;
    if (s.focused === null) return;
    s.zoom = clamp(s.zoom * (1 - e.deltaY * 0.0016), MIN_ZOOM, MAX_ZOOM);
  }, []);

  // Escape key exits inspect mode / closes settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSettings(false);
        unfocus();
      }
      if (e.key === 'ArrowLeft') selectSuit(stateRef.current.target - 1, stateRef.current.focused !== null);
      if (e.key === 'ArrowRight') selectSuit(stateRef.current.target + 1, stateRef.current.focused !== null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectSuit, unfocus]);

  // BUILD: hand the model to the fabrication bay (Jarvis speaks once a
  // machine is actually selected there, not here)
  const startBuild = useCallback(() => {
    const item = items[clamp(uiFocused ?? uiSelected, 0, count - 1)];
    sfx('select', 0.6);
    window.dispatchEvent(new CustomEvent('jarvis:navigate', {
      detail: { page: 'manufacturing', buildModel: item },
    }));
  }, [items, uiFocused, uiSelected, count]);

  const theme = THEMES[settings.theme];
  const b = settings.brightness;
  const activeSuit = items[clamp(uiFocused ?? uiSelected, 0, count - 1)];

  return (
    <motion.div
      className="fixed inset-0 z-[50] overflow-hidden flex flex-col"
      style={{ background: '#020814' }}
      initial={{ x: '100%', filter: 'blur(24px)', opacity: 0 }}
      animate={{ x: 0, filter: 'blur(0px)', opacity: 1 }}
      exit={{ x: '-100%', filter: 'blur(24px)', opacity: 0 }}
      transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
    >
      <style>{`
        @keyframes scanline-spidey {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
      `}</style>

      {/* Ambient background: blue haze + dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 90% 60% at 50% 90%, rgba(14,80,160,0.35) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 50% 0%, rgba(20,60,120,0.25) 0%, transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, ${theme.primary}24 1px, transparent 1px)`,
          backgroundSize: '30px 30px',
        }}
      />

      {/* Scan line */}
      <div
        className="absolute inset-x-0 h-px pointer-events-none z-[2]"
        style={{
          background: `linear-gradient(90deg,transparent,${theme.primary}4d,transparent)`,
          animation: 'scanline-spidey 8s linear infinite',
        }}
      />

      {/* HUD corner brackets */}
      {[
        ['top-3 left-3', 'border-t border-l'],
        ['top-3 right-3', 'border-t border-r'],
        ['bottom-3 left-3', 'border-b border-l'],
        ['bottom-3 right-3', 'border-b border-r'],
      ].map(([pos, border]) => (
        <div
          key={pos}
          className={`absolute ${pos} w-6 h-6 ${border} pointer-events-none z-[3]`}
          style={{ borderColor: `${theme.primary}66` }}
        />
      ))}

      <PageHeader title="Spider-Man Armory" onNavigateHome={onNavigateHome} accent="red" />

      {/* 3D stage */}
      <div
        className="flex-1 relative"
        style={{ touchAction: 'none', cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => endDrag()}
        onWheel={onWheel}
      >
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 2.3, 9.6], fov: 38 }}
          gl={{ alpha: true, antialias: true }}
          style={{ width: '100%', height: '100%', background: 'transparent' }}
          onCreated={({ camera }) => {
            camera.lookAt(0, 1.25, 0);
          }}
          onPointerMissed={() => {
            if (drag.current.moved < 6 && stateRef.current.focused !== null) unfocus();
          }}
        >
          <fog attach="fog" args={['#020814', 13, 30]} />

          {/* Lighting: cool key + theme rims, scaled by brightness */}
          <ambientLight intensity={0.55 * b} color="#8ab4d8" />
          <directionalLight position={[4, 8, 6]} intensity={1.6 * b} color="#e8f4ff" />
          <directionalLight position={[0, 3, 9]} intensity={0.7 * b} color="#ffffff" />
          <directionalLight position={[-6, 3, -4]} intensity={1.1 * b} color={theme.primary} />
          <directionalLight position={[6, 2, -6]} intensity={0.7 * b} color="#3b82f6" />

          {/* Holographic floor grid */}
          <Grid
            position={[0, 0, 0]}
            infiniteGrid
            cellSize={0.65}
            sectionSize={3.25}
            cellThickness={0.6}
            sectionThickness={1.1}
            cellColor={theme.grid[0]}
            sectionColor={theme.grid[1]}
            fadeDistance={28}
            fadeStrength={1.6}
          />

          <CarouselRig stateRef={stateRef} accessory={isAccessory} />

          {items.map((item, i) => (
            <SuitSlot
              key={`${category}-${i}`}
              index={i}
              item={item}
              accessory={isAccessory}
              stateRef={stateRef}
              onSuitClick={onSuitClick}
              uiActive={(uiFocused ?? uiSelected) === i}
              settings={settings}
            />
          ))}
        </Canvas>

        {/* Category toggle: Suits / Accessories */}
        <div
          className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex rounded-lg overflow-hidden"
          style={{
            background: 'rgba(2,8,20,0.75)',
            border: `1px solid ${theme.primary}44`,
            backdropFilter: 'blur(12px)',
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(['suits', 'accessories'] as Category[]).map((cat) => (
            <button
              key={cat}
              onClick={() => switchCategory(cat)}
              disabled={switching}
              className="relative px-5 py-2 font-mono text-[10px] uppercase tracking-[0.25em] transition-colors"
              style={{ color: category === cat ? '#fff' : 'rgba(255,255,255,0.35)' }}
            >
              {category === cat && (
                <motion.div
                  layoutId="armory-cat-pill"
                  className="absolute inset-0"
                  style={{ background: `${theme.primary}2e`, boxShadow: `inset 0 0 12px ${theme.primary}33` }}
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative">{cat === 'suits' ? 'Suits' : 'Accessories'}</span>
            </button>
          ))}
        </div>

        {/* Settings gear */}
        <button
          onClick={() => setShowSettings((v) => !v)}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-4 right-4 z-20 p-2 rounded-lg transition-all"
          style={{
            color: showSettings ? theme.primary : 'rgba(255,255,255,0.4)',
            background: showSettings ? `${theme.primary}1a` : 'transparent',
            border: `1px solid ${showSettings ? `${theme.primary}66` : 'rgba(255,255,255,0.1)'}`,
          }}
          aria-label="Suit display settings"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        <AnimatePresence>
          {showSettings && <SettingsPanel settings={settings} onChange={patchSettings} />}
        </AnimatePresence>

        {/* Left / right arrows */}
        {uiFocused === null && (
          <>
            <button
              onClick={() => selectSuit(stateRef.current.target - 1, false)}
              disabled={uiSelected === 0}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 disabled:opacity-15 transition-all"
              style={{ color: `${theme.primary}88` }}
              aria-label="Previous suit"
            >
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <button
              onClick={() => selectSuit(stateRef.current.target + 1, false)}
              disabled={uiSelected === count - 1}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 disabled:opacity-15 transition-all"
              style={{ color: `${theme.primary}88` }}
              aria-label="Next suit"
            >
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        {/* Close inspect mode */}
        {uiFocused !== null && (
          <button
            onClick={unfocus}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-4 right-16 z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-white/40 hover:text-white transition-colors"
          >
            ✕ Close
          </button>
        )}

        {/* Bottom info panel */}
        <div className="absolute bottom-0 inset-x-0 z-10 flex flex-col items-center gap-3 pb-6 pointer-events-none">
          <div className="text-center">
            <h1
              className="text-2xl font-bold uppercase tracking-[0.35em] text-white"
              style={{ textShadow: `0 0 24px ${theme.primary}99` }}
            >
              {activeSuit.name}
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] mt-1.5" style={{ color: `${theme.primary}99` }}>
              {activeSuit.sub}
            </p>
          </div>

          {/* BUILD — send the inspected accessory to the fabrication bay */}
          <AnimatePresence>
            {isAccessory && uiFocused !== null && (
              <motion.button
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                onClick={startBuild}
                onPointerDown={(e) => e.stopPropagation()}
                className="pointer-events-auto relative px-8 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.4em] text-black group"
                style={{
                  background: `linear-gradient(90deg, ${theme.primary}, ${theme.bright})`,
                  clipPath: 'polygon(12px 0, 100% 0, calc(100% - 12px) 100%, 0 100%)',
                  boxShadow: `0 0 24px ${theme.primary}88, 0 0 60px ${theme.primary}33`,
                }}
              >
                <span className="relative z-10">▸ Build</span>
                <span
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(255,255,255,0.25)' }}
                />
              </motion.button>
            )}
          </AnimatePresence>

          {/* Pagination dots */}
          <div className="flex items-center gap-2.5 pointer-events-auto">
            {items.map((_, i) => (
              <button
                key={`${category}-dot-${i}`}
                onClick={() => selectSuit(i, uiFocused !== null)}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Select ${items[i].name}`}
                className="p-1"
              >
                <div
                  className="rounded-full transition-all duration-300"
                  style={{
                    width: (uiFocused ?? uiSelected) === i ? 22 : 7,
                    height: 7,
                    background:
                      (uiFocused ?? uiSelected) === i
                        ? `linear-gradient(90deg, ${theme.primary}, ${theme.bright})`
                        : 'rgba(255,255,255,0.18)',
                    boxShadow: (uiFocused ?? uiSelected) === i ? `0 0 10px ${theme.primary}` : 'none',
                  }}
                />
              </button>
            ))}
          </div>

          <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-white/25">
            {uiFocused !== null
              ? isAccessory
                ? 'Drag to tumble · Pinch or scroll to zoom · Esc to exit'
                : 'Drag to spin · Pinch or scroll to zoom · Esc to exit'
              : `Swipe to browse · Tap ${isAccessory ? 'an accessory' : 'a suit'} to inspect`}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
