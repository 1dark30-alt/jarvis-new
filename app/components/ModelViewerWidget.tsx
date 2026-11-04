'use client';

import { Suspense, useLayoutEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { motion } from 'framer-motion';
import * as THREE from 'three';

function AutoFitModel({ url }: { url: string }) {
  const { scene: gltfScene } = useGLTF(url);
  const spinRef   = useRef<THREE.Group>(null);
  const centerRef = useRef<THREE.Group>(null);

  // Use targeted selectors so this component doesn't re-render every frame
  const camera   = useThree(s => s.camera);
  const r3fScene = useThree(s => s.scene);

  useLayoutEffect(() => {
    if (!centerRef.current) return;

    r3fScene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(gltfScene);
    if (box.isEmpty()) return;

    const worldCenter = box.getCenter(new THREE.Vector3());
    const modelSize   = box.getSize(new THREE.Vector3());

    centerRef.current.position.set(-worldCenter.x, worldCenter.y, worldCenter.z);

    const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
    const fov    = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const dist   = (maxDim / 2) / Math.tan(fov / 2) * 2.4;

    camera.position.set(0, 0, dist);
    camera.near = dist / 200;
    camera.far  = dist * 200;
    camera.lookAt(0, 0, 0);
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, [gltfScene, camera, r3fScene]);

  useFrame((_, delta) => {
    if (spinRef.current) spinRef.current.rotation.y += delta * 0.4;
  });

  return (
    <group ref={spinRef}>
      <group rotation={[Math.PI, 0, 0]}>
        <group ref={centerRef}>
          <primitive object={gltfScene} />
        </group>
      </group>
    </group>
  );
}

interface Props {
  modelPath: string;
  modelName: string;
  onClose: () => void;
}

export function ModelViewerWidget({ modelPath, modelName, onClose }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      className="absolute inset-0 z-20 pointer-events-auto"
      style={{ borderRadius: '50%', overflow: 'hidden' }}
    >
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        dpr={[1, 2]}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
        gl={{ alpha: true }}
      >
        <ambientLight intensity={1} />
        <directionalLight position={[5, 5, 5]} intensity={1.5} />
        <directionalLight position={[-5, -3, -5]} intensity={0.4} color="#22d3ee" />
        <Suspense fallback={null}>
          <AutoFitModel url={modelPath} />
        </Suspense>
      </Canvas>

      <div className="absolute top-[18%] left-0 right-0 text-center pointer-events-none select-none">
        <span
          className="text-5xl font-bold uppercase tracking-[0.25em] text-white"
          style={{ textShadow: '0 2px 20px rgba(255,255,255,0.5)' }}
        >
          {modelName}
        </span>
      </div>

      <button
        onClick={onClose}
        className="absolute top-[22%] right-[18%] text-white/50 hover:text-white transition-colors text-sm pointer-events-auto"
      >
        ✕
      </button>
    </motion.div>
  );
}
