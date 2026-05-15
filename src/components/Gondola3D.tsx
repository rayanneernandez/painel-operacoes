import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, RoundedBox, Text, useTexture, Html } from '@react-three/drei';
import * as THREE from 'three';

export type ProductSlot = {
  position: number;
  code: string;
  name: string;
  image: string;
  status: 'ok' | 'warning' | 'rupture';
};

type GondolaProps = {
  products: ProductSlot[];
  onSlotClick?: (product: ProductSlot) => void;
};

const SHELF_COUNT = 3;
const SHELF_WIDTH = 3.6;
const SHELF_DEPTH = 0.8;
const SHELF_SPACING = 1.15;
const SHELF_THICKNESS = 0.06;
const SIDE_PANEL_HEIGHT = SHELF_COUNT * SHELF_SPACING + 0.5;

const STATUS_COLORS = {
  ok: '#10b981',
  warning: '#f97316',
  rupture: '#ef4444',
};

function ShelfStructure() {
  const metalColor = '#3a3f47';
  const shelfColor = '#e8e8e8';

  return (
    <group>
      {/* Side panels */}
      {[-SHELF_WIDTH / 2 - 0.04, SHELF_WIDTH / 2 + 0.04].map((x, i) => (
        <mesh key={`side-${i}`} position={[x, SIDE_PANEL_HEIGHT / 2 - 0.2, 0]}>
          <boxGeometry args={[0.05, SIDE_PANEL_HEIGHT, SHELF_DEPTH]} />
          <meshStandardMaterial color={metalColor} metalness={0.6} roughness={0.3} />
        </mesh>
      ))}

      {/* Back panel */}
      <mesh position={[0, SIDE_PANEL_HEIGHT / 2 - 0.2, -SHELF_DEPTH / 2 + 0.01]}>
        <boxGeometry args={[SHELF_WIDTH + 0.13, SIDE_PANEL_HEIGHT, 0.02]} />
        <meshStandardMaterial color="#2a2e35" metalness={0.3} roughness={0.5} />
      </mesh>

      {/* Shelves */}
      {Array.from({ length: SHELF_COUNT }, (_, i) => {
        const y = i * SHELF_SPACING;
        return (
          <mesh key={`shelf-${i}`} position={[0, y, 0]}>
            <boxGeometry args={[SHELF_WIDTH + 0.08, SHELF_THICKNESS, SHELF_DEPTH]} />
            <meshStandardMaterial color={shelfColor} metalness={0.15} roughness={0.6} />
          </mesh>
        );
      })}

      {/* Top rail */}
      <mesh position={[0, SHELF_COUNT * SHELF_SPACING, -SHELF_DEPTH / 2 + 0.03]}>
        <boxGeometry args={[SHELF_WIDTH + 0.08, 0.04, 0.04]} />
        <meshStandardMaterial color={metalColor} metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Price tag rails on each shelf */}
      {Array.from({ length: SHELF_COUNT }, (_, i) => {
        const y = i * SHELF_SPACING + SHELF_THICKNESS / 2 + 0.005;
        return (
          <mesh key={`rail-${i}`} position={[0, y, SHELF_DEPTH / 2 - 0.02]}>
            <boxGeometry args={[SHELF_WIDTH + 0.08, 0.04, 0.03]} />
            <meshStandardMaterial color="#d1d5db" metalness={0.2} roughness={0.5} />
          </mesh>
        );
      })}
    </group>
  );
}

function ProductBox({
  product,
  slotIndex,
  shelfIndex,
  totalSlots,
  onClick,
}: {
  product: ProductSlot;
  slotIndex: number;
  shelfIndex: number;
  totalSlots: number;
  onClick?: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const texture = useTexture(product.image);

  const boxW = SHELF_WIDTH / totalSlots - 0.08;
  const boxH = SHELF_SPACING - SHELF_THICKNESS - 0.2;
  const boxD = SHELF_DEPTH * 0.55;

  const x = (slotIndex - (totalSlots - 1) / 2) * (SHELF_WIDTH / totalSlots);
  const y = shelfIndex * SHELF_SPACING + SHELF_THICKNESS / 2 + boxH / 2 + 0.02;
  const z = 0;

  const isRupture = product.status === 'rupture';
  const isWarning = product.status === 'warning';

  useFrame((state) => {
    if (!meshRef.current) return;
    if (isRupture) {
      const pulse = Math.sin(state.clock.elapsedTime * 3) * 0.03;
      meshRef.current.position.y = y + pulse;
    }
  });

  const opacity = isRupture ? 0.15 : 1;
  const emissiveColor = isRupture ? '#ef4444' : isWarning ? '#f97316' : '#000000';
  const emissiveIntensity = isRupture ? 0.4 : isWarning ? 0.15 : 0;

  return (
    <group>
      <mesh
        ref={meshRef}
        position={[x, y, z]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={onClick}
        scale={hovered && !isRupture ? 1.05 : 1}
      >
        <boxGeometry args={[boxW, boxH, boxD]} />
        <meshStandardMaterial
          map={isRupture ? null : texture}
          color={isRupture ? '#1a1a2e' : '#ffffff'}
          transparent={isRupture}
          opacity={opacity}
          emissive={emissiveColor}
          emissiveIntensity={emissiveIntensity}
          roughness={0.5}
          metalness={0.05}
        />
      </mesh>

      {/* Status indicator glow on shelf */}
      {(isRupture || isWarning) && (
        <mesh position={[x, shelfIndex * SHELF_SPACING + SHELF_THICKNESS / 2 + 0.01, SHELF_DEPTH / 2 - 0.06]}>
          <planeGeometry args={[boxW + 0.04, 0.03]} />
          <meshBasicMaterial color={STATUS_COLORS[product.status]} transparent opacity={0.9} />
        </mesh>
      )}

      {/* Rupture X overlay */}
      {isRupture && (
        <Html position={[x, y, boxD / 2 + 0.01]} center distanceFactor={4} style={{ pointerEvents: 'none' }}>
          <div style={{
            width: 60, height: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '50%',
            background: 'rgba(239,68,68,0.2)',
            border: '2px solid rgba(239,68,68,0.6)',
            backdropFilter: 'blur(4px)',
          }}>
            <span style={{ color: '#ef4444', fontSize: 28, fontWeight: 900, lineHeight: 1 }}>!</span>
          </div>
        </Html>
      )}

      {/* Hover tooltip */}
      {hovered && (
        <Html position={[x, y + boxH / 2 + 0.15, boxD / 2 + 0.1]} center distanceFactor={5} style={{ pointerEvents: 'none' }}>
          <div style={{
            background: 'rgba(13,17,23,0.95)',
            border: `1px solid ${STATUS_COLORS[product.status]}40`,
            borderRadius: 10,
            padding: '8px 12px',
            whiteSpace: 'nowrap',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            <div style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{product.name}</div>
            <div style={{ color: '#9ca3af', fontSize: 10, marginTop: 2 }}>Cód: {product.code}</div>
            <div style={{
              marginTop: 4, fontSize: 10, fontWeight: 600,
              color: STATUS_COLORS[product.status],
              textTransform: 'uppercase', letterSpacing: 1,
            }}>
              {product.status === 'ok' ? 'Abastecido' : product.status === 'warning' ? 'Estoque baixo' : 'Ruptura'}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

function GondolaScene({ products, onSlotClick }: GondolaProps) {
  const groupRef = useRef<THREE.Group>(null);

  return (
    <group ref={groupRef}>
      <ShelfStructure />
      {Array.from({ length: SHELF_COUNT }, (_, shelfIdx) =>
        products.map((product, slotIdx) => (
          <ProductBox
            key={`${shelfIdx}-${product.position}`}
            product={product}
            slotIndex={slotIdx}
            shelfIndex={shelfIdx}
            totalSlots={products.length}
            onClick={() => onSlotClick?.(product)}
          />
        ))
      )}
    </group>
  );
}

function readLightTheme() {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset.appTheme === 'light'
    || Boolean(document.querySelector('[data-dashboard-theme="light"]'));
}

function useLightTheme() {
  const [light, setLight] = useState(readLightTheme);
  useEffect(() => {
    const update = () => setLight(readLightTheme());
    window.addEventListener('app-theme-change', update);
    window.addEventListener('dashboard-theme-change', update);
    window.addEventListener('storage', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-theme'] });
    document.querySelectorAll('[data-dashboard-theme]').forEach((el) => {
      observer.observe(el, { attributes: true, attributeFilter: ['data-dashboard-theme'] });
    });
    return () => {
      window.removeEventListener('app-theme-change', update);
      window.removeEventListener('dashboard-theme-change', update);
      window.removeEventListener('storage', update);
      observer.disconnect();
    };
  }, []);
  return light;
}

function StatusLegend({ products }: { products: ProductSlot[] }) {
  const counts = useMemo(() => {
    const c = { ok: 0, warning: 0, rupture: 0 };
    products.forEach((p) => { c[p.status]++; });
    return c;
  }, [products]);

  return (
    <div className="absolute bottom-3 left-3 flex items-center gap-3 bg-[#0d1117]/90 backdrop-blur-sm border border-gray-800/60 rounded-xl px-3 py-2">
      {[
        { key: 'ok' as const, label: 'Abastecido', color: '#10b981' },
        { key: 'warning' as const, label: 'Estoque baixo', color: '#f97316' },
        { key: 'rupture' as const, label: 'Ruptura', color: '#ef4444' },
      ].map((item) => (
        <div key={item.key} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color, boxShadow: `0 0 6px ${item.color}60` }} />
          <span className="text-[10px] text-gray-400 font-medium">
            {item.label} ({counts[item.key]})
          </span>
        </div>
      ))}
    </div>
  );
}

export function Gondola3D({ products, onSlotClick }: GondolaProps) {
  const isLight = useLightTheme();
  const sceneBg = isLight ? '#f8fafc' : '#0a0d12';
  const floorColor = isLight ? '#e2e8f0' : '#0d1117';

  return (
    <div className="relative w-full h-full min-h-[350px] bg-[#0a0d12] rounded-2xl overflow-hidden border border-gray-800/40">
      <div className="absolute top-3 left-3 z-10">
        <div className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Gôndola 3D</div>
        <div className="text-xs text-gray-200/70 mt-0.5">Colunas 4–6 · Frios Fatiados</div>
      </div>
      <Canvas
        camera={{ position: [0, 1.5, 4.5], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={[sceneBg]} />
        <fog attach="fog" args={[sceneBg, 6, 12]} />

        <ambientLight intensity={isLight ? 0.75 : 0.4} />
        <directionalLight position={[3, 5, 4]} intensity={isLight ? 1 : 0.8} castShadow />
        <directionalLight position={[-2, 3, 2]} intensity={isLight ? 0.45 : 0.3} />
        <pointLight position={[0, 3, 2]} intensity={isLight ? 0.55 : 0.4} color="#ffffff" />

        <GondolaScene products={products} onSlotClick={onSlotClick} />

        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={2.5}
          maxDistance={8}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.2}
          target={[0, 1.2, 0]}
        />

        {/* Floor reflection */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
          <planeGeometry args={[10, 10]} />
          <meshStandardMaterial color={floorColor} metalness={isLight ? 0.2 : 0.8} roughness={isLight ? 0.65 : 0.4} />
        </mesh>
      </Canvas>
      <StatusLegend products={products} />
    </div>
  );
}
