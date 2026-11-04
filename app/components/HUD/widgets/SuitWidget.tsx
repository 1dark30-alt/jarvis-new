'use client';

import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { STLLoader } from 'three-stdlib';
import { Suspense, useRef, useState } from 'react';
import { OrbitControls, Center, PerspectiveCamera, Edges } from '@react-three/drei';
import * as THREE from 'three';

function Model({ url, color, wireframe }: { url: string; color: string; wireframe: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useLoader(STLLoader, url);

  // Center the geometry itself once loaded
  if (geometry) {
    geometry.center();
  }

  // Auto-rotate the group/container, not the mesh directly if it has complex transforms
  useFrame((state, delta) => {
    if (meshRef.current) {
      // We rotate the mesh around its local Z axis because it's rotated -90deg on X
      // Local Z becomes global Y in this orientation
      meshRef.current.rotation.z += delta * 0.5;
    }
  });

  return (
    <Center>
      <mesh 
        ref={meshRef} 
        geometry={geometry} 
        rotation={[-Math.PI / 2, 0, 0]} // Initial orientation fix
        scale={0.05}
      >
        <meshStandardMaterial 
          color={color} 
          wireframe={wireframe} 
          metalness={0.6} 
          roughness={0.3} 
          emissive={color}
          emissiveIntensity={0.4}
        />
        {!wireframe && <Edges threshold={20} color="white" opacity={0.3} transparent />}
      </mesh>
    </Center>
  );
}

export function SuitWidget() {
  const [color, setColor] = useState('#ef4444');
  const [wireframe, setWireframe] = useState(false);

  return (
    <div className="w-full h-full min-h-0 min-w-0 flex overflow-hidden">
      <div className="min-w-0 flex-1 relative h-full overflow-hidden">
        <Canvas className="!block h-full w-full">
          <PerspectiveCamera makeDefault position={[0, 0, 4.5]} />
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} intensity={1} />
          <pointLight position={[-10, -10, -10]} intensity={0.5} />
          
          <Suspense fallback={null}>
             <Model url="/models/suit2.stl" color={color} wireframe={wireframe} />
          </Suspense>
          <OrbitControls enableZoom={true} enablePan={true} />
        </Canvas>
      </div>

      {/* Settings Panel */}
      <div className="hidden min-w-0 shrink-0 group-[.expanded]:flex w-64 border-l border-cyan-500/30 bg-black/40 p-4 flex-col gap-4 transition-all duration-300 overflow-y-auto">
        <h3 className="text-cyan-400 font-bold tracking-widest text-sm border-b border-cyan-500/30 pb-2">SUIT CONFIG</h3>
        
        <div className="space-y-2">
          <label className="text-xs text-cyan-500 uppercase">Color Overlay</label>
          <div className="grid grid-cols-4 gap-2">
            {['#22d3ee', '#ef4444', '#eab308', '#22c55e', '#ffffff', '#a855f7'].map((c) => (
              <button
                key={c}
                onClick={(e) => { e.stopPropagation(); setColor(c); }}
                className={`w-8 h-8 rounded-full border ${color === c ? 'border-white scale-110' : 'border-transparent opacity-50 hover:opacity-100'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
           <label className="text-xs text-cyan-500 uppercase">Render Mode</label>
           <button
             onClick={(e) => { e.stopPropagation(); setWireframe(!wireframe); }}
             className={`w-full py-2 px-3 rounded border text-xs font-mono transition-all ${
               wireframe 
                 ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300' 
                 : 'bg-transparent border-cyan-500/20 text-cyan-600 hover:text-cyan-400'
             }`}
           >
             {wireframe ? 'WIREFRAME ONLY' : 'SOLID MESH'}
           </button>
        </div>
      </div>
    </div>
  );
}
