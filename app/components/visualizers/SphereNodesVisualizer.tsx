'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';

// ── tuneable constants ─────────────────────────────────────────────────────
const SHELL_NODES      = 650;
const ORBIT_COUNT      = 5;
const STRAY_COUNT      = 450;
const LOGO_SAMPLE      = 256;
const MAX_LOGO_SPHERES = 5200;
const LOGO_WORLD_SCALE = 2.10;


// Background rectangular arc-reactor ring — 3 groups with alternating thin/thick segments
const ARC_GROUPS        = 3;
const ARC_SEGS_PER_GRP  = 18;
const BG_ARC_RINGS = [
  { r: 1.10, groupSpan: 0.88, speed: 0.048, z: -0.16, segH: 0.14 },
] as const;
const BG_ARC_SEG_TOTAL = BG_ARC_RINGS.length * ARC_GROUPS * ARC_SEGS_PER_GRP;

// ── stray orbit helpers ───────────────────────────────────────────────────
interface OrbitPath {
  baseU: THREE.Vector3; baseV: THREE.Vector3;
  tiltAxis: THREE.Vector3;
  rotSpeed: number; // rad/s for plane rotation (slow)
  speed: number;    // rad/s for nodes around orbit (fast)
}

function buildOrbitPaths(): OrbitPath[] {
  return Array.from({ length: ORBIT_COUNT }, (_, p) => {
    const normal = new THREE.Vector3(
      hash01(p * 19.3) * 2 - 1,
      hash01(p * 31.7) * 2 - 1,
      hash01(p * 43.1) * 2 - 1,
    ).normalize();
    const up   = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const baseU = new THREE.Vector3().crossVectors(normal, up).normalize();
    const baseV = new THREE.Vector3().crossVectors(normal, baseU).normalize();
    const tiltAxis = new THREE.Vector3(
      hash01(p * 7.1) * 2 - 1,
      hash01(p * 13.5) * 2 - 1,
      hash01(p * 23.9) * 2 - 1,
    ).normalize();
    return {
      baseU, baseV, tiltAxis,
      rotSpeed: (0.04 + hash01(p * 5.7) * 0.06) * (hash01(p * 17.3) < 0.5 ? 1 : -1),
      speed:    (3.0  + hash01(p * 11.1) * 4.0) * (hash01(p * 29.7) < 0.5 ? 1 : -1),
    };
  });
}

function buildStrayPhases(): Float32Array {
  const a = new Float32Array(STRAY_COUNT);
  for (let i = 0; i < STRAY_COUNT; i++) a[i] = hash01(i * 37.3) * Math.PI * 2;
  return a;
}

// Per-frame scratch for orbit plane vectors
const _q      = new THREE.Quaternion();
const _orbitU = Array.from({ length: ORBIT_COUNT }, () => new THREE.Vector3());
const _orbitV = Array.from({ length: ORBIT_COUNT }, () => new THREE.Vector3());

const _YELLOW   = new THREE.Color('#f59e0b');
const _segColor = new THREE.Color();

// ── helpers ────────────────────────────────────────────────────────────────
function hash01(n: number) {
  return Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1;
}

function fibonacciSpherePoints(count: number, radius: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y     = count > 1 ? 1 - (i / (count - 1)) * 2 : 0;
    const yr    = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push(new THREE.Vector3(Math.cos(theta) * yr * radius, y * radius, Math.sin(theta) * yr * radius));
  }
  return pts;
}

function sampleLogoPoints(texture: THREE.Texture): THREE.Vector3[] {
  const img = texture.image as HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  if (!img || !('width' in img)) return [];

  const w = LOGO_SAMPLE, h = LOGO_SAMPLE;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  }
  const avg            = sum / (data.length / 4);
  const darkBackground = avg < 0.42;
  const takePixel      = (lum: number) => (darkBackground ? lum > 0.48 : lum < 0.52);

  const raw: THREE.Vector3[] = [];
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      if (data[i + 3] < 24) continue;
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      if (!takePixel(lum)) continue;
      const nx = px / w - 0.5;
      const ny = -(py / h) + 0.5;
      raw.push(new THREE.Vector3(
        nx * LOGO_WORLD_SCALE + (hash01(px * 0.7 + py * 1.3) - 0.5) * 0.014,
        ny * LOGO_WORLD_SCALE + (hash01(px * 1.1 + py * 0.9) - 0.5) * 0.014,
        (hash01(px + py * 31) - 0.5) * 0.12
      ));
    }
  }
  for (let i = raw.length - 1; i > 0; i--) {
    const j = Math.floor(hash01(i + raw.length) * (i + 1));
    [raw[i], raw[j]] = [raw[j], raw[i]];
  }
  return raw.slice(0, MAX_LOGO_SPHERES);
}


// ── component ─────────────────────────────────────────────────────────────
interface Props {
  fftData: number[];
  status: 'idle' | 'listening' | 'active' | 'error';
  logoUrl: string;
}

function Scene({ fftData, status, logoUrl }: Props) {
  const shellGroupRef = useRef<THREE.Group>(null);
  const shellMeshRef  = useRef<THREE.InstancedMesh>(null);
  const logoRef       = useRef<THREE.InstancedMesh>(null);

  const geoGroupRef   = useRef<THREE.Group>(null);
  const arcBgRef      = useRef<THREE.InstancedMesh>(null);
  const strayMeshRef  = useRef<THREE.InstancedMesh>(null);

  const fftRef    = useRef(fftData);
  const statusRef = useRef(status);
  useEffect(() => { fftRef.current    = fftData; }, [fftData]);
  useEffect(() => { statusRef.current = status;  }, [status]);

  const texture    = useTexture(logoUrl);
  const logoPoints = useMemo(() => sampleLogoPoints(texture), [texture]);

  const bases = useMemo(() => fibonacciSpherePoints(SHELL_NODES, 1), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const glitchImpulse = useRef(new Float32Array(SHELL_NODES * 3));
  const driftPhase    = useRef(new Float32Array(SHELL_NODES));

  useEffect(() => {
    for (let i = 0; i < SHELL_NODES; i++) driftPhase.current[i] = hash01(i * 17.23) * Math.PI * 2;
  }, []);

  const orbitPaths  = useMemo(() => buildOrbitPaths(), []);
  const strayPhases = useMemo(() => buildStrayPhases(), []);

  // ── static geometries ─────────────────────────────────────────────────────
  const shellGeo   = useMemo(() => new THREE.SphereGeometry(1, 7, 7), []);
  const logoGeo    = useMemo(() => new THREE.SphereGeometry(1, 7, 7), []);
  const strayGeo   = useMemo(() => new THREE.SphereGeometry(1, 8, 8), []);
  const arcBgGeo = useMemo(() => {
    // Trapezoid — wider at y=+0.5 (outer edge), narrower at y=-0.5 (inner edge)
    // taper ≈ inner_r / outer_r for ring at r=1.10, h=0.14
    const taper = 0.882;
    const geo   = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -0.5,          -0.5, 0,  // outer-left  (wide)
       0.5,          -0.5, 0,  // outer-right (wide)
       0.5 * taper,   0.5, 0,  // inner-right (narrow)
      -0.5 * taper,   0.5, 0,  // inner-left  (narrow)
    ]), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    geo.computeVertexNormals();
    return geo;
  }, []);
  const geoIcoGeo  = useMemo(() => new THREE.IcosahedronGeometry(0.54, 2), []);
  const geoEdgeGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.54, 2)), []);

  // ── materials ─────────────────────────────────────────────────────────────
  const shellMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#22d3ee', emissive: '#22d3ee', emissiveIntensity: 1.1, metalness: 0.2, roughness: 0.4,
  }), []);

  const logoMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 2.2, metalness: 0.0, roughness: 0.3,
  }), []);

  // Stray nodes — white base so instance colour shows through directly
  const strayMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: true, opacity: 0.60,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }), []);


  // Background arc-reactor rectangular segments
  const arcBgMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: true, opacity: 1.0,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
  }), []);

  // Geodesic sphere
  const geoSolidMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#083344', transparent: true, opacity: 0.72, depthWrite: false,
  }), []);
  const geoWireMat = useMemo(() => new THREE.LineBasicMaterial({
    color: '#e0f2fe', transparent: true, opacity: 0.50, depthWrite: false,
  }), []);

  // Haze spheres around the node cloud
  const hazeMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#0891b2', transparent: true, opacity: 0.038,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }), []);
  const hazeMat2 = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#06b6d4', transparent: true, opacity: 0.018,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  }), []);

  const accentRgbRef   = useRef('');
  const accentColorRef = useRef(new THREE.Color('#22d3ee'));
  const accentLightRef = useRef<THREE.PointLight>(null);

  const _vRef  = useRef(new THREE.Vector3());
  const _wvRef = useRef(new THREE.Vector3());

  useFrame((state, delta) => {
    const t   = state.clock.elapsedTime;

    // ── accent colour ──────────────────────────────────────────────────────
    const rgb = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
    if (rgb && rgb !== accentRgbRef.current) {
      accentRgbRef.current = rgb;
      const css = `rgb(${rgb})`;
      shellMat.color.set(css);
      shellMat.emissive.set(css);
      accentColorRef.current.set(css);
      hazeMat.color.set(css);
      if (accentLightRef.current) accentLightRef.current.color.set(css);
    }

    const active = statusRef.current === 'active';
    const fft    = fftRef.current;
    const nBin   = Math.max(fft.length, 1);

    // ── stray nodes — shared orbit paths that slowly precess ─────────────
    const stray = strayMeshRef.current;
    if (stray) {
      // Compute current orientation for each orbit plane
      for (let oi = 0; oi < ORBIT_COUNT; oi++) {
        const op = orbitPaths[oi];
        _q.setFromAxisAngle(op.tiltAxis, t * op.rotSpeed);
        _orbitU[oi].copy(op.baseU).applyQuaternion(_q);
        _orbitV[oi].copy(op.baseV).applyQuaternion(_q);
      }

      const activeStray = Math.floor(t * 2.2) % STRAY_COUNT;
      for (let si = 0; si < STRAY_COUNT; si++) {
        const oi    = si % ORBIT_COUNT;
        const op    = orbitPaths[oi];
        const angle = t * op.speed + strayPhases[si];
        const cos   = Math.cos(angle);
        const sin   = Math.sin(angle);
        const r     = si === activeStray ? 1.12 : 1.04;
        dummy.position.set(
          (_orbitU[oi].x * cos + _orbitV[oi].x * sin) * r,
          (_orbitU[oi].y * cos + _orbitV[oi].y * sin) * r,
          (_orbitU[oi].z * cos + _orbitV[oi].z * sin) * r,
        );
        dummy.scale.setScalar(si === activeStray ? 0.014 : 0.008);
        dummy.updateMatrix();
        stray.setMatrixAt(si, dummy.matrix);
        stray.setColorAt(si, si === activeStray ? _YELLOW : accentColorRef.current);
      }
      stray.instanceMatrix.needsUpdate = true;
      if (stray.instanceColor) stray.instanceColor.needsUpdate = true;
    }

    // ── geodesic sphere rotation ──────────────────────────────────────────
    const geoGrp = geoGroupRef.current;
    if (geoGrp) {
      geoGrp.rotation.y += delta * 0.07;
      geoGrp.rotation.z += delta * 0.025;
      // Scale with audio volume
      let vol = 0;
      for (let i = 0; i < fft.length; i++) vol += fft[i];
      vol = fft.length > 0 ? vol / fft.length : 0;
      // Hard clamp: front face is at z = -0.56 + 0.54*scale, must stay < 0
      const geoScale = Math.min(1 + vol * 0.08, 1.03);
      geoGrp.scale.setScalar(geoScale);
    }

    // ── logo cloud ────────────────────────────────────────────────────────
    const logo = logoRef.current;
    if (logo) {
      const floatAmp = active ? 0.0045 : 0.008;
      for (let i = 0; i < logoPoints.length; i++) {
        const p = logoPoints[i];
        dummy.position.set(
          p.x + Math.sin(t * 1.1 + i * 0.07) * floatAmp,
          p.y + Math.cos(t * 0.9 + i * 0.05) * floatAmp,
          p.z + Math.sin(t * 0.8 + i * 0.03) * floatAmp * 0.6,
        );
        dummy.scale.setScalar(0.0045);
        dummy.updateMatrix();
        logo.setMatrixAt(i, dummy.matrix);
      }
      logo.instanceMatrix.needsUpdate = true;
    }

    // ── background arc-reactor — each segment = one FFT bin, glow on beat ──
    const arcBg = arcBgRef.current;
    if (arcBg) {
      let idx = 0;
      const totalSegs = ARC_GROUPS * ARC_SEGS_PER_GRP;
      for (const rd of BG_ARC_RINGS) {
        const sliceAngle   = (Math.PI * 2) / ARC_GROUPS;
        const groupArcSpan = sliceAngle * rd.groupSpan;
        const innerStep    = groupArcSpan / ARC_SEGS_PER_GRP;
        const segWidth     = rd.r * innerStep * 0.97;
        for (let g = 0; g < ARC_GROUPS; g++) {
          const groupBase = g * sliceAngle;
          for (let s = 0; s < ARC_SEGS_PER_GRP; s++) {
            const segIdx = g * ARC_SEGS_PER_GRP + s;
            const bin    = Math.min(Math.floor((segIdx / totalSegs) * nBin), nBin - 1);
            const f      = fft[bin] ?? 0;
            // Minimum brightness = 0.28, scales up to 1.0 at full FFT
            const bright = 0.28 + f * 0.72;
            _segColor.copy(accentColorRef.current).multiplyScalar(bright);

            const angle = t * rd.speed + groupBase + s * innerStep + innerStep * 0.5;
            dummy.position.set(Math.cos(angle) * rd.r, Math.sin(angle) * rd.r, rd.z);
            dummy.rotation.set(0, 0, angle + Math.PI / 2);
            dummy.scale.set(segWidth, rd.segH, 1);
            dummy.updateMatrix();
            arcBg.setMatrixAt(idx, dummy.matrix);
            arcBg.setColorAt(idx, _segColor);
            idx++;
          }
        }
      }
      arcBg.instanceMatrix.needsUpdate = true;
      if (arcBg.instanceColor) arcBg.instanceColor.needsUpdate = true;
      dummy.rotation.set(0, 0, 0);
    }
  });

  const logoCount = Math.max(logoPoints.length, 1);

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight ref={accentLightRef} position={[4, 4, 6]}   intensity={1.4} color="#22d3ee" />
      <pointLight                      position={[-5, -2, -4]} intensity={0.4} color="#ffffff" />

      {/* Background arc-reactor rectangular rings */}
      <instancedMesh ref={arcBgRef} args={[arcBgGeo, arcBgMat, BG_ARC_SEG_TOTAL]} renderOrder={1} />

      {/* Geodesic sphere (behind logo, slow rotation) */}
      <group ref={geoGroupRef} position={[0, 0, -0.56]} renderOrder={2}>
        <mesh geometry={geoIcoGeo} material={geoSolidMat} />
        <lineSegments geometry={geoEdgeGeo} material={geoWireMat} />
      </group>

      {/* Haze enveloping the node cloud (renders after bg, before fg) */}
      <mesh renderOrder={3}>
        <sphereGeometry args={[1.05, 28, 16]} />
        <primitive object={hazeMat} attach="material" />
      </mesh>
      <mesh renderOrder={3}>
        <sphereGeometry args={[1.18, 28, 16]} />
        <primitive object={hazeMat2} attach="material" />
      </mesh>

      {/* Stray fast-orbit nodes */}
      <instancedMesh ref={strayMeshRef} args={[strayGeo, strayMat, STRAY_COUNT]} renderOrder={4} />

      {/* Jarvis logo particle cloud */}
      {logoPoints.length > 0 && (
        <instancedMesh ref={logoRef} args={[logoGeo, logoMat, logoCount]} renderOrder={5} />
      )}
    </>
  );
}

export function SphereNodesVisualizer({ fftData, status, logoUrl }: Props) {
  return (
    <Canvas
      className="h-full w-full"
      style={{ display: 'block' }}
      camera={{ position: [0, 0, 4.6], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
    >
      <Suspense fallback={null}>
        <Scene fftData={fftData} status={status} logoUrl={logoUrl} />
      </Suspense>
    </Canvas>
  );
}
