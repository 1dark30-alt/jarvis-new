'use client';

import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF, Bounds, Environment } from '@react-three/drei';
import * as THREE from 'three';

function AutoFitModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.5;
  });

  return (
    <Bounds fit clip observe margin={1.4}>
      <group rotation={[Math.PI, 0, 0]}>
        <group ref={groupRef}>
          <primitive object={scene} />
        </group>
      </group>
    </Bounds>
  );
}

export function ModelHudWidget({ modelPath }: { modelPath: string }) {
  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 1, 5], fov: 40 }}
        style={{ background: 'transparent' }}
        gl={{ alpha: true }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 5, 5]} intensity={1.4} />
        <pointLight position={[-4, -4, -4]} intensity={0.5} color="#22d3ee" />
        <Suspense fallback={null}>
          <AutoFitModel url={modelPath} />
          <Environment preset="city" />
        </Suspense>
      </Canvas>
    </div>
  );
}
