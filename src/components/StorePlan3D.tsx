import { useRef, useState, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Line, Text } from '@react-three/drei';
import * as THREE from 'three';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContactPoint = {
  id: string;
  name: string;
  pos: [number, number]; // [x, y] in store coords (grid 0-10.5 × 0-8)
  icon?: string;
  heatValue?: number;
  flowCount?: number;
};

// ── Store dimensions (from floor plan grid) ───────────────────────────────────

const W = 10.5; // x: 0 → 10.5
const D = 8.0;  // y: 0 → 8

// ── 11 contact points (camera positions from the map) ─────────────────────────

export const LED_CONTACT_POINTS: ContactPoint[] = [
  { id: 'quina_3d',      name: 'Quina 3D',           pos: [0.72, 2.72], icon: '3D', heatValue: 0.55, flowCount: 320  },
  { id: 'megabanner',    name: 'Megabanner',          pos: [2.08, 6.25], icon: 'MB', heatValue: 0.70, flowCount: 520  },
  { id: 'dashboard_cam', name: 'Dashboard',           pos: [3.05, 6.75], icon: 'DB', heatValue: 0.45, flowCount: 280  },
  { id: 'caixa',         name: 'Caixa',               pos: [5.25, 7.35], icon: 'CX', heatValue: 0.90, flowCount: 850  },
  { id: 'olobox',        name: 'Olobox',              pos: [8.82, 6.43], icon: 'OL', heatValue: 0.35, flowCount: 210  },
  { id: 'prat_virtual',  name: 'Prateleira Virtual',  pos: [5.00, 5.15], icon: 'PV', heatValue: 0.60, flowCount: 390  },
  { id: 'entrada_loja',  name: 'Entrada Loja',        pos: [2.55, 4.15], icon: 'IN', heatValue: 1.00, flowCount: 1200 },
  { id: 'tv_tunel_esq',  name: 'TV Tunel Esquerda',   pos: [7.92, 3.95], icon: 'TE', heatValue: 0.50, flowCount: 310  },
  { id: 'tv_tunel_dir',  name: 'TV Tunel Direita',    pos: [9.42, 2.72], icon: 'TD', heatValue: 0.40, flowCount: 260  },
  { id: 'drinks',        name: 'Drinks',              pos: [3.72, 1.75], icon: 'DR', heatValue: 0.65, flowCount: 430  },
  { id: 'entrada_tunel', name: 'Entrada Tunel',       pos: [9.05, 1.18], icon: 'ET', heatValue: 0.75, flowCount: 580  },
];

// ── Coordinate system ─────────────────────────────────────────────────────────
// Floor plan: x right, y up. Three.js: X right, Y up (height), Z forward.
// We map: plan-x → Three-X (centered), plan-y → Three-(-Z) (flipped), height → Three-Y

function S(x: number, y: number, h = 0): [number, number, number] {
  return [x - W / 2, h, -(y - D / 2)];
}

function heatColor(v: number): string {
  if (v < 0.25) return '#3b82f6';
  if (v < 0.50) return '#10b981';
  if (v < 0.75) return '#f59e0b';
  return '#ef4444';
}

// ── Generic geometry helpers ──────────────────────────────────────────────────

/** Box by bottom-left corner in plan coords */
function PlanBox({ x, y, w, d, h, color, emissive, emI, opacity, metal, rough }: {
  x: number; y: number; w: number; d: number; h: number; color: string;
  emissive?: string; emI?: number; opacity?: number; metal?: number; rough?: number;
}) {
  const [px, , pz] = S(x + w / 2, y + d / 2, h / 2);
  return (
    <mesh position={[px, h / 2, pz]} receiveShadow castShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial
        color={color}
        emissive={emissive ?? '#000'}
        emissiveIntensity={emI ?? 0}
        transparent={(opacity ?? 1) < 1}
        opacity={opacity ?? 1}
        metalness={metal ?? 0.05}
        roughness={rough ?? 0.85}
      />
    </mesh>
  );
}

/** Wall segment between two plan points */
function PlanWall({ x1, y1, x2, y2, h, t, color }: {
  x1: number; y1: number; x2: number; y2: number; h: number; t: number; color?: string;
}) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ang = Math.atan2(dx, dy);
  const [px, , pz] = S((x1 + x2) / 2, (y1 + y2) / 2, h / 2);
  return (
    <mesh position={[px, h / 2, pz]} rotation={[0, ang, 0]} receiveShadow castShadow>
      <boxGeometry args={[t, h, len]} />
      <meshStandardMaterial color={color ?? '#1e293b'} roughness={0.9} />
    </mesh>
  );
}

/** Glowing LED panel */
function LED({ x, y, w, d, h, color, intensity }: {
  x: number; y: number; w: number; d: number; h: number; color: string; intensity?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const i = intensity ?? 2;
  useFrame(({ clock }) => {
    if (ref.current) {
      (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        i + Math.sin(clock.elapsedTime * 1.2) * 0.3;
    }
  });
  const [px, , pz] = S(x + w / 2, y + d / 2, h);
  return (
    <mesh ref={ref} position={[px, h, pz]}>
      <boxGeometry args={[w, 0.04, d]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={i} roughness={0.1} metalness={0.7} />
    </mesh>
  );
}

/** Cylinder column */
function Col({ x, y, r, h, color }: { x: number; y: number; r: number; h: number; color?: string }) {
  const [px, , pz] = S(x, y, h / 2);
  return (
    <mesh position={[px, h / 2, pz]} castShadow>
      <cylinderGeometry args={[r, r, h, 12]} />
      <meshStandardMaterial color={color ?? '#374151'} roughness={0.5} metalness={0.4} />
    </mesh>
  );
}

/** Flat floor overlay */
function Floor({ x, y, w, d, color, elev }: { x: number; y: number; w: number; d: number; color: string; elev?: number }) {
  const [px, , pz] = S(x + w / 2, y + d / 2);
  return (
    <mesh position={[px, elev ?? 0.004, pz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

/** Shelf rack (side panels + shelf boards) */
function Shelf({ x, y, w, d, n }: { x: number; y: number; w: number; d: number; n: number }) {
  const totalH = n * 0.25;
  const elems: JSX.Element[] = [];
  // side panels
  elems.push(<PlanBox key="sl" x={x} y={y} w={0.03} d={d} h={totalH} color="#9ca3af" metal={0.5} rough={0.4} />);
  elems.push(<PlanBox key="sr" x={x + w - 0.03} y={y} w={0.03} d={d} h={totalH} color="#9ca3af" metal={0.5} rough={0.4} />);
  // shelf boards (back panel)
  elems.push(<PlanBox key="back" x={x} y={y + d - 0.025} w={w} d={0.025} h={totalH} color="#d4cdbf" />);
  for (let i = 0; i <= n; i++) {
    const sh = i * 0.25;
    const [px, , pz] = S(x + w / 2, y + d / 2, sh);
    elems.push(
      <mesh key={`b${i}`} position={[px, sh, pz]}>
        <boxGeometry args={[w, 0.025, d]} />
        <meshStandardMaterial color="#a89070" roughness={0.6} metalness={0.1} />
      </mesh>
    );
  }
  return <>{elems}</>;
}

/** Text label on the floor */
function FloorLabel({ text, x, y, size }: { text: string; x: number; y: number; size?: number }) {
  const [px, , pz] = S(x, y);
  return (
    <Text position={[px, 0.015, pz]} rotation={[-Math.PI / 2, 0, 0]}
      fontSize={size ?? 0.16} color="#5a5045" anchorX="center" anchorY="middle" font={undefined}
      outlineWidth={0.005} outlineColor="#ffffff"
    >{text}</Text>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STORE GEOMETRY — following the floor plan exactly
// ══════════════════════════════════════════════════════════════════════════════

function StoreGeometry() {
  return (
    <>
      {/* ── FLOORS (light architectural tones) ───────────────────── */}
      {/* Base floor — light warm wood / porcelain */}
      <Floor x={0} y={0} w={W} d={D} color="#e9e2d4" />
      {/* Piso MDF Preto Brilhante — bar entrance strip (dark wood plank) */}
      <Floor x={0} y={0} w={4.0} d={0.4} color="#3a2a1e" elev={0.012} />
      {/* Tunnel floor (right half, darker polished concrete) */}
      <Floor x={5.0} y={0} w={5.5} d={5.0} color="#c9bfb0" elev={0.007} />
      {/* Checkout / caixa area (slightly warmer) */}
      <Floor x={3.0} y={6.0} w={4.0} d={2.0} color="#ede5d6" elev={0.007} />
      {/* Bar area floor (dark hardwood) */}
      <Floor x={0} y={0} w={3.5} d={1.5} color="#5c4a36" elev={0.007} />
      {/* Tunnel walking strip (carpet/runner) */}
      <Floor x={6.8} y={0.8} w={1.6} d={4.5} color="#a89888" elev={0.009} />

      {/* ── OUTER WALLS (white/cream architectural) ──────────────── */}
      <PlanWall x1={0}    y1={0} x2={10.5} y2={0}   h={0.85} t={0.14} color="#f4f0e8" />
      <PlanWall x1={0}    y1={8} x2={10.5} y2={8}   h={0.85} t={0.14} color="#f4f0e8" />
      <PlanWall x1={0}    y1={0} x2={0}    y2={8}   h={0.85} t={0.14} color="#f4f0e8" />
      <PlanWall x1={10.5} y1={0} x2={10.5} y2={8}   h={0.85} t={0.14} color="#f4f0e8" />
      {/* Baseboards (rodapés) */}
      <PlanWall x1={0.14} y1={0.07} x2={10.36} y2={0.07} h={0.06} t={0.02} color="#2b2b2b" />
      <PlanWall x1={0.14} y1={7.93} x2={10.36} y2={7.93} h={0.06} t={0.02} color="#2b2b2b" />
      <PlanWall x1={0.07} y1={0.14} x2={0.07}  y2={7.86} h={0.06} t={0.02} color="#2b2b2b" />
      <PlanWall x1={10.43} y1={0.14} x2={10.43} y2={7.86} h={0.06} t={0.02} color="#2b2b2b" />

      {/* ── DEPÓSITO (storage room) — white drywall partitions ─── */}
      <PlanWall x1={3.2} y1={3.8} x2={5.0} y2={3.8} h={0.7} t={0.08} color="#dad3c4" />
      <PlanWall x1={3.2} y1={5.5} x2={5.0} y2={5.5} h={0.7} t={0.08} color="#dad3c4" />
      <PlanWall x1={3.2} y1={3.8} x2={3.2} y2={5.5} h={0.7} t={0.08} color="#dad3c4" />
      {/* East wall with door gap */}
      <PlanWall x1={5.0} y1={3.8} x2={5.0} y2={4.7} h={0.7} t={0.08} color="#dad3c4" />
      <PlanWall x1={5.0} y1={5.2} x2={5.0} y2={5.5} h={0.7} t={0.08} color="#dad3c4" />
      {/* Door frame (top piece) */}
      <PlanBox x={5.0} y={4.7} w={0.08} d={0.5} h={0.05} color="#2b2b2b" />
      <Floor x={3.2} y={3.8} w={1.8} d={1.7} color="#bfb7a6" elev={0.008} />
      <FloorLabel text="DEPÓSITO" x={4.1} y={4.7} />

      {/* ── BALCÃO BAR — wood + marble counter ──────────────────── */}
      {/* Main counter body (dark wood) */}
      <PlanBox x={0.3} y={0.3} w={2.7} d={0.45} h={0.9} color="#3d2a1a" rough={0.5} metal={0.1} />
      {/* Side return */}
      <PlanBox x={0.3} y={0.3} w={0.45} d={0.9} h={0.9} color="#3d2a1a" rough={0.5} metal={0.1} />
      {/* Marble top */}
      <PlanBox x={0.28} y={0.28} w={2.74} d={0.49} h={0.05} color="#e8e3d8" rough={0.15} metal={0.4} />
      <PlanBox x={0.28} y={0.28} w={0.49} d={0.94} h={0.05} color="#e8e3d8" rough={0.15} metal={0.4} />
      {/* Workspace behind */}
      <PlanBox x={0.8} y={0.75} w={2.0} d={0.4} h={0.08} color="#a89070" rough={0.4} />
      {/* Bar stools (chrome + leather) */}
      {[1.0, 1.5, 2.0, 2.5].map((xp) => (
        <group key={`stool${xp}`}>
          <Col x={xp} y={1.1} r={0.05} h={0.55} color="#9ca3af" />
          <PlanBox x={xp - 0.15} y={0.95} w={0.3} d={0.3} h={0.05} color="#1f1410" />
        </group>
      ))}
      <FloorLabel text="BALCÃO BAR" x={1.6} y={0.6} />

      {/* ── BANCADA (work surface) — wood with white top ─────────── */}
      <PlanBox x={1.0} y={2.8} w={1.5} d={1.9} h={0.85} color="#5c4a36" rough={0.6} />
      <PlanBox x={0.98} y={2.78} w={1.54} d={1.94} h={0.04} color="#f5f0e6" rough={0.2} metal={0.3} />
      <FloorLabel text="BANCADA" x={1.8} y={3.6} size={0.14} />

      {/* ── BANCADA APOIO ────────────────────────────────────────── */}
      <PlanBox x={6.0} y={3.8} w={1.5} d={1.0} h={0.85} color="#5c4a36" rough={0.6} />
      <PlanBox x={5.98} y={3.78} w={1.54} d={1.04} h={0.04} color="#f5f0e6" rough={0.2} metal={0.3} />
      <FloorLabel text="BANCADA APOIO" x={6.75} y={4.3} size={0.12} />

      {/* ── GEL — glass-front display fridge ─────────────────────── */}
      <PlanBox x={5.2} y={4.2} w={0.6} d={0.6} h={1.4} color="#cdd5dc" rough={0.25} metal={0.6} opacity={0.85} />
      <PlanBox x={5.22} y={4.22} w={0.56} d={0.56} h={1.35} color="#88b4ff" emissive="#5b9eff" emI={0.4} rough={0.1} metal={0.2} opacity={0.55} />
      <FloorLabel text="GEL" x={5.5} y={4.5} size={0.12} />

      {/* ── PRATELEIRAS — Main store (x≈2.5-4.5, y≈2.5-3.8) ───── */}
      <Shelf x={2.8} y={2.6} w={1.4} d={0.45} n={4} />
      <Shelf x={2.8} y={3.2} w={1.4} d={0.45} n={4} />
      <FloorLabel text="PRATELEIRAS" x={3.5} y={3.0} size={0.12} />

      {/* ── PRATELEIRAS — Tunnel area ───────────────────────────── */}
      {/* Left column of shelves (x≈5.5-7.0) */}
      <Shelf x={5.5} y={0.8} w={1.4} d={0.5} n={4} />
      <Shelf x={5.5} y={1.5} w={1.4} d={0.5} n={4} />
      <Shelf x={5.5} y={2.2} w={1.4} d={0.5} n={4} />
      <Shelf x={5.5} y={2.9} w={1.4} d={0.5} n={4} />
      {/* Right column of shelves (x≈7.5-9.5) */}
      <Shelf x={7.8} y={0.8} w={1.5} d={0.5} n={4} />
      <Shelf x={7.8} y={1.5} w={1.5} d={0.5} n={4} />
      <Shelf x={7.8} y={2.2} w={1.5} d={0.5} n={4} />
      <FloorLabel text="PRATELEIRAS" x={7.0} y={2.0} size={0.12} />

      {/* ── DRINKS — display unit with glass front ──────────────── */}
      <PlanBox x={3.0} y={1.5} w={1.2} d={0.9} h={0.4} color="#5c4a36" rough={0.6} />
      {/* Cooler / fridge with glass */}
      <PlanBox x={3.1} y={1.6} w={0.5} d={0.7} h={1.5} color="#d4cdbf" rough={0.3} metal={0.4} />
      <PlanBox x={3.12} y={1.62} w={0.46} d={0.66} h={1.45} color="#a8d4ff" emissive="#5b9eff" emI={0.3} rough={0.1} opacity={0.6} />
      <FloorLabel text="DRINKS" x={3.6} y={2.0} />

      {/* ── CHECK OUT — light wood counter with stone top ───────── */}
      <PlanBox x={3.5} y={6.5} w={2.5} d={0.5} h={0.9} color="#5c4a36" rough={0.5} />
      <PlanBox x={3.48} y={6.48} w={2.54} d={0.54} h={0.04} color="#e8e3d8" rough={0.15} metal={0.4} />
      {/* Cash register (POS terminal) */}
      <PlanBox x={4.5} y={6.6} w={0.45} d={0.3} h={0.15} color="#1f1f1f" rough={0.3} metal={0.5} />
      <LED x={4.52} y={6.62} w={0.4} d={0.25} h={0.16} color="#22d3ee" intensity={0.8} />
      <FloorLabel text="CHECK OUT" x={4.5} y={6.8} />

      {/* ── CAIXA backing (wall display) ─────────────────────────── */}
      <PlanBox x={4.3} y={7.2} w={1.2} d={0.5} h={0.4} color="#5c4a36" rough={0.5} />
      <PlanBox x={4.28} y={7.18} w={1.24} d={0.54} h={0.04} color="#e8e3d8" rough={0.15} metal={0.4} />

      {/* ── OLOBOX DO CLIENTE — interactive display cabinet ─────── */}
      <PlanBox x={8.0} y={6.5} w={1.5} d={1.0} h={1.6} color="#f5f0e6" rough={0.4} />
      <PlanBox x={8.05} y={6.52} w={1.4} d={0.06} h={1.4} color="#1a1a1a" rough={0.3} />
      <LED x={8.1} y={6.55} w={1.3} d={0.04} h={1.35} color="#6366f1" intensity={1.4} />
      <FloorLabel text="OLOBOX" x={8.75} y={7.0} size={0.13} />

      {/* ── TOTEM — tall pillar with LED screen ─────────────────── */}
      <PlanBox x={5.65} y={1.05} w={0.35} d={0.3} h={1.95} color="#f5f0e6" rough={0.4} />
      <LED x={5.66} y={1.06} w={0.33} d={0.04} h={1.9} color="#7c3aed" intensity={2.2} />
      <FloorLabel text="TOTEM" x={5.8} y={0.7} size={0.11} />

      {/* ── SANCA TETO — ceiling soffit beams (above) ──────────── */}
      {[5.2, 5.9, 6.6, 7.3].map((xp) => (
        <PlanBox key={`viga${xp}`} x={xp} y={5.3} w={0.1} d={1.5} h={0.06} color="#f4f0e8" />
      ))}
      <FloorLabel text="SANCA TETO" x={6.3} y={5.8} size={0.11} />

      {/* ── STRUCTURAL COLUMNS (white painted) ──────────────────── */}
      <Col x={3.2} y={5.5} r={0.12} h={2.2} color="#f4f0e8" />
      <Col x={5.0} y={5.5} r={0.12} h={2.2} color="#f4f0e8" />
      <Col x={5.0} y={6.5} r={0.12} h={2.2} color="#f4f0e8" />

      {/* ══════════════ LED INSTALLATIONS (mounted on walls) ══════════════ */}

      {/* Testeira em LED 16m — bottom (south) wall, mounted above */}
      <LED x={1.5} y={0.02} w={7.0} d={0.06} h={0.78} color="#7c3aed" intensity={2.2} />

      {/* Calha LED em Perfil 11.5M — left wall band */}
      <LED x={0.08} y={2.0} w={0.04} d={4.0} h={0.78} color="#c084fc" intensity={2.4} />

      {/* Calha LED em Perfil 26.5m — bottom wall band (tunnel) */}
      <LED x={5.0} y={0.02} w={5.5} d={0.06} h={0.4} color="#c084fc" intensity={2.0} />

      {/* Painel LED 2.56m × 2.4m — top-right corner (mounted on north wall) */}
      <PlanBox x={7.9} y={7.92} w={2.56} d={0.04} h={1.6} color="#f4f0e8" />
      <LED x={7.95} y={7.91} w={2.46} d={0.03} h={1.5} color="#8b5cf6" intensity={2.6} />

      {/* Logo Letra Caixa Backlight — top wall center */}
      <PlanBox x={3.5} y={7.92} w={3.0} d={0.04} h={1.0} color="#f4f0e8" />
      <LED x={3.55} y={7.91} w={2.9} d={0.03} h={0.85} color="#e9d5ff" intensity={2.5} />

      {/* Megabanner — left wall y≈5.5-7.5 (large vertical panel) */}
      <PlanBox x={0.04} y={5.5} w={0.04} d={2.0} h={1.7} color="#1a1040" />
      <LED x={0.08} y={5.55} w={0.03} d={1.9} h={1.6} color="#a855f7" intensity={2.4} />

      {/* Painel Vitrine / Instalação Conecta — left wall y≈6.8-7.5 */}
      <PlanBox x={0.12} y={6.85} w={0.04} d={0.7} h={1.2} color="#f4f0e8" />
      <LED x={0.16} y={6.88} w={0.03} d={0.64} h={1.1} color="#6366f1" intensity={1.8} />

      {/* Coluna com Fita LED — top-left corner */}
      <Col x={0.35} y={7.65} r={0.16} h={2.2} color="#f4f0e8" />
      <LED x={0.22} y={7.52} w={0.04} d={0.04} h={2.1} color="#c084fc" intensity={2.5} />
      <LED x={0.5}  y={7.52} w={0.04} d={0.04} h={2.1} color="#c084fc" intensity={2.5} />

      {/* Coluna em LED — bottom-center */}
      <Col x={6.5} y={0.4} r={0.2} h={2.2} color="#f4f0e8" />
      <LED x={6.3} y={0.22} w={0.04} d={0.04} h={2.1} color="#a855f7" intensity={2.2} />
      <LED x={6.7} y={0.22} w={0.04} d={0.04} h={2.1} color="#a855f7" intensity={2.2} />

      {/* Coluna em LED — bottom-right */}
      <Col x={10.0} y={0.4} r={0.2} h={2.2} color="#f4f0e8" />
      <LED x={9.8}  y={0.22} w={0.04} d={0.04} h={2.1} color="#a855f7" intensity={2.2} />
      <LED x={10.2} y={0.22} w={0.04} d={0.04} h={2.1} color="#a855f7" intensity={2.2} />

      {/* Passarela em Painel LED 1M × 1M — right wall vertical strip */}
      {Array.from({ length: 6 }, (_, i) => (
        <LED key={`pass${i}`} x={10.42} y={1.8 + i * 0.8} w={0.04} d={0.7} h={0.7} color="#7c3aed" intensity={1.6} />
      ))}

      {/* Quina 3D — corner LED display (rounded panel) */}
      <PlanBox x={0.08} y={2.6} w={0.04} d={0.7} h={1.4} color="#1a1040" />
      <LED x={0.12} y={2.62} w={0.03} d={0.66} h={1.3} color="#06b6d4" intensity={2.2} />

      {/* ══════════════ ENTRANCES ══════════════ */}

      {/* Entrada Loja (x≈2.3-3.5, y≈4.3) — green arch */}
      <PlanBox x={2.3} y={4.2} w={0.1} d={0.1} h={0.6} color="#059669" emissive="#059669" emI={1.8} />
      <PlanBox x={3.5} y={4.2} w={0.1} d={0.1} h={0.6} color="#059669" emissive="#059669" emI={1.8} />
      <PlanBox x={2.3} y={4.22} w={1.3} d={0.06} h={0.03} color="#059669" emissive="#059669" emI={2} />
      <FloorLabel text="ENTRADA LOJA" x={2.9} y={4.5} size={0.11} />

      {/* Entrada Túnel (x≈7.5-8.8, y≈1.0) — blue arch */}
      <PlanBox x={7.4} y={0.9} w={0.1} d={0.1} h={0.55} color="#0ea5e9" emissive="#0ea5e9" emI={1.8} />
      <PlanBox x={8.6} y={0.9} w={0.1} d={0.1} h={0.55} color="#0ea5e9" emissive="#0ea5e9" emI={1.8} />
      <PlanBox x={7.4} y={0.92} w={1.3} d={0.06} h={0.03} color="#0ea5e9" emissive="#0ea5e9" emI={2} />
      <FloorLabel text="ENTRADA TÚNEL" x={8.0} y={0.6} size={0.11} />

      {/* ── FLOOR LABELS ────────────────────────────────────────── */}
      <FloorLabel text="TÚNEL" x={8.5} y={3.8} />

      {/* ── GRID HELPER ─────────────────────────────────────────── */}
      <gridHelper args={[12, 12, '#b0a898', '#cfc8b8']} position={[0, 0.002, 0]} />
    </>
  );
}

// ── Heat circle ────────────────────────────────────────────────────────────────

function PlanLine({ points, color, width, height = 0.025, opacity = 1 }: {
  points: [number, number][]; color: string; width: number; height?: number; opacity?: number;
}) {
  return (
    <Line
      points={points.map(([x, y]) => S(x, y, height))}
      color={color}
      lineWidth={width}
      transparent={opacity < 1}
      opacity={opacity}
    />
  );
}

function PlanRect({ x, y, w, d, color = '#ef4444', width = 0.8, height = 0.028, opacity = 0.55 }: {
  x: number; y: number; w: number; d: number; color?: string; width?: number; height?: number; opacity?: number;
}) {
  return (
    <PlanLine
      points={[[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]]}
      color={color}
      width={width}
      height={height}
      opacity={opacity}
    />
  );
}

function PlanTiles() {
  const lines: JSX.Element[] = [];
  for (let x = 0; x <= 10; x++) {
    lines.push(<PlanLine key={`tx${x}`} points={[[x, 0], [x, D]]} color="#cfc8bc" width={0.45} height={0.018} opacity={0.5} />);
  }
  for (let y = 0; y <= 8; y++) {
    lines.push(<PlanLine key={`ty${y}`} points={[[0, y], [W, y]]} color="#cfc8bc" width={0.45} height={0.018} opacity={0.5} />);
  }
  lines.push(<PlanLine key="tx105" points={[[10.5, 0], [10.5, D]]} color="#cfc8bc" width={0.45} height={0.018} opacity={0.5} />);
  return <>{lines}</>;
}

function VerticalLed({ x, y, w, d, h, color, intensity = 2, label }: {
  x: number; y: number; w: number; d: number; h: number; color: string; intensity?: number; label?: string;
}) {
  return (
    <>
      <PlanBox x={x} y={y} w={w} d={d} h={h} color="#111827" rough={0.22} metal={0.45} />
      <PlanBox
        x={x + 0.015}
        y={y + 0.015}
        w={Math.max(w - 0.03, 0.02)}
        d={Math.max(d - 0.03, 0.02)}
        h={Math.max(h - 0.04, 0.04)}
        color={color}
        emissive={color}
        emI={intensity}
        rough={0.12}
        metal={0.35}
        opacity={0.9}
      />
      {label && <FloorLabel text={label} x={x + w / 2} y={y + d / 2} size={0.11} />}
    </>
  );
}

function FloorPlanLabel({ text, x, y, size }: { text: string; x: number; y: number; size?: number }) {
  const [px, , pz] = S(x, y);
  return (
    <Text
      position={[px, 0.035, pz]}
      rotation={[-Math.PI / 2, 0, 0]}
      fontSize={size ?? 0.18}
      color="#1f2937"
      anchorX="center"
      anchorY="middle"
      outlineWidth={0.006}
      outlineColor="#ffffff"
    >
      {text}
    </Text>
  );
}

function AccurateStoreGeometry() {
  const shelfRows = [0.95, 1.65, 2.35, 3.05, 3.75, 4.45];

  return (
    <>
      <Floor x={0} y={0} w={W} d={D} color="#eee7dc" />
      <Floor x={0.05} y={0.05} w={10.35} d={7.85} color="#f7f4ee" elev={0.003} />
      <Floor x={0.0} y={0.0} w={4.45} d={1.12} color="#d9cf9e" elev={0.009} />
      <Floor x={1.7} y={1.1} w={3.8} d={4.35} color="#e4dfd4" elev={0.008} />
      <Floor x={2.55} y={5.42} w={4.95} d={2.42} color="#b7ddf0" elev={0.01} />
      <Floor x={7.55} y={0.88} w={2.42} d={5.95} color="#b9e1f3" elev={0.012} />
      <Floor x={8.78} y={0.88} w={0.86} d={5.58} color="#d8c3b1" elev={0.014} />
      <Floor x={6.9} y={4.95} w={2.58} d={1.08} color="#d1e8f2" elev={0.014} />
      <PlanTiles />

      <PlanRect x={0} y={0} w={10.5} d={8} width={1.15} opacity={0.72} />
      <PlanRect x={1.95} y={0.9} w={7.8} d={6.05} width={0.75} opacity={0.45} />
      <PlanRect x={2.55} y={1.28} w={6.65} d={4.48} width={0.55} opacity={0.38} />
      <PlanLine points={[[0, 6.95], [1.08, 6.5], [0, 6.08]]} color="#ef4444" width={0.7} height={0.03} opacity={0.48} />
      <PlanLine points={[[0, 0.15], [0.58, 1.1], [0, 2.05]]} color="#ef4444" width={0.7} height={0.03} opacity={0.48} />
      <PlanLine points={[[10.5, 0.05], [9.75, 1.1], [10.5, 2.0]]} color="#ef4444" width={0.7} height={0.03} opacity={0.48} />
      <PlanLine points={[[10.5, 5.6], [9.65, 6.25], [10.5, 7.2]]} color="#ef4444" width={0.7} height={0.03} opacity={0.48} />

      <PlanWall x1={0} y1={0} x2={10.5} y2={0} h={0.55} t={0.07} color="#f3eee5" />
      <PlanWall x1={0} y1={8} x2={10.5} y2={8} h={0.55} t={0.07} color="#f3eee5" />
      <PlanWall x1={0} y1={0} x2={0} y2={8} h={0.55} t={0.07} color="#f3eee5" />
      <PlanWall x1={10.5} y1={0} x2={10.5} y2={8} h={0.55} t={0.07} color="#f3eee5" />
      <PlanWall x1={1.95} y1={1.05} x2={1.95} y2={7.6} h={0.76} t={0.08} color="#ddd5c8" />
      <PlanWall x1={1.95} y1={5.55} x2={7.55} y2={5.55} h={0.64} t={0.07} color="#ddd5c8" />
      <PlanWall x1={7.55} y1={0.82} x2={7.55} y2={6.78} h={0.74} t={0.08} color="#d8d0c4" />
      <PlanWall x1={9.75} y1={0.82} x2={9.75} y2={6.78} h={0.74} t={0.08} color="#d8d0c4" />
      <PlanWall x1={7.55} y1={6.78} x2={9.75} y2={6.78} h={0.74} t={0.08} color="#d8d0c4" />
      <PlanWall x1={2.42} y1={3.35} x2={2.42} y2={5.35} h={0.54} t={0.05} color="#c9c1b5" />
      <PlanWall x1={2.42} y1={3.35} x2={5.72} y2={3.35} h={0.54} t={0.05} color="#c9c1b5" />
      <PlanWall x1={5.72} y1={3.35} x2={5.72} y2={5.35} h={0.54} t={0.05} color="#c9c1b5" />
      <PlanWall x1={2.42} y1={5.35} x2={5.72} y2={5.35} h={0.54} t={0.05} color="#c9c1b5" />

      <PlanBox x={1.28} y={0.72} w={2.92} d={0.36} h={0.78} color="#d7c967" rough={0.42} />
      <PlanBox x={1.28} y={0.72} w={0.36} d={2.6} h={0.78} color="#d7c967" rough={0.42} />
      <PlanBox x={1.18} y={0.63} w={3.12} d={0.12} h={0.06} color="#f8f3df" rough={0.18} metal={0.25} />
      <PlanBox x={1.2} y={3.05} w={0.86} d={1.42} h={0.72} color="#bfb7aa" rough={0.52} />
      <PlanBox x={2.1} y={2.88} w={0.68} d={1.64} h={0.72} color="#c6beb2" rough={0.52} />
      <PlanBox x={2.62} y={3.5} w={0.24} d={0.52} h={0.78} color="#f3f0e8" rough={0.3} metal={0.2} />
      <PlanBox x={3.15} y={2.15} w={2.42} d={0.44} h={0.34} color="#d8d1c5" rough={0.55} />
      <PlanBox x={3.1} y={3.02} w={1.72} d={0.42} h={0.58} color="#c9c1b5" rough={0.6} />
      <PlanBox x={5.74} y={4.06} w={0.58} d={0.78} h={1.18} color="#d5d9dc" rough={0.25} metal={0.35} />
      <PlanBox x={5.78} y={4.1} w={0.5} d={0.7} h={1.1} color="#b7dcff" emissive="#60a5fa" emI={0.45} rough={0.08} opacity={0.58} />
      <PlanBox x={5.98} y={3.1} w={0.72} d={1.22} h={0.72} color="#a69884" rough={0.55} />
      <PlanBox x={6.84} y={3.18} w={0.38} d={1.56} h={0.72} color="#c9c1b5" rough={0.58} />

      <PlanBox x={2.88} y={6.12} w={3.78} d={0.52} h={0.7} color="#80c2df" rough={0.36} />
      <PlanBox x={3.5} y={6.56} w={1.52} d={0.55} h={0.78} color="#3b82a4" rough={0.38} />
      <PlanBox x={5.32} y={7.03} w={2.42} d={0.4} h={0.92} color="#030712" rough={0.35} />
      <VerticalLed x={3.36} y={7.55} w={4.3} d={0.08} h={0.72} color="#e9d5ff" intensity={2.2} label="LOGO BACKLIGHT" />
      <VerticalLed x={7.86} y={7.55} w={2.55} d={0.08} h={1.58} color="#a78bfa" intensity={2.4} label="PAINEL LED" />
      <PlanBox x={8.12} y={6.76} w={1.42} d={0.72} h={1.15} color="#d9cdb8" rough={0.45} />
      <PlanBox x={8.18} y={6.81} w={1.3} d={0.08} h={1.0} color="#15111f" emissive="#8b5cf6" emI={1.4} rough={0.2} />

      <VerticalLed x={0.06} y={5.58} w={0.08} d={1.82} h={1.62} color="#a855f7" intensity={2.2} label="MEGABANNER" />
      <VerticalLed x={0.06} y={2.48} w={0.08} d={0.92} h={1.18} color="#06b6d4" intensity={2.1} label="QUINA 3D" />
      <VerticalLed x={0.14} y={3.82} w={0.06} d={1.42} h={1.05} color="#60a5fa" intensity={1.8} label="CALHA LED" />
      <Col x={1.52} y={7.55} r={0.12} h={1.86} color="#efe9dc" />
      <VerticalLed x={1.42} y={7.35} w={0.2} d={0.05} h={1.78} color="#f59e0b" intensity={1.6} />

      <VerticalLed x={3.54} y={5.08} w={3.72} d={0.34} h={0.88} color="#a855f7" intensity={2.1} label="PRATELEIRA VIRTUAL" />
      <PlanBox x={3.7} y={4.76} w={3.34} d={0.28} h={0.42} color="#ded6cb" rough={0.55} />
      <PlanBox x={3.08} y={1.48} w={1.24} d={0.62} h={0.62} color="#8b6f4c" rough={0.5} />
      <PlanBox x={3.2} y={1.56} w={0.48} d={0.46} h={1.18} color="#d7e2e8" rough={0.25} metal={0.3} />
      <PlanBox x={3.23} y={1.59} w={0.42} d={0.4} h={1.1} color="#a5d8ff" emissive="#38bdf8" emI={0.35} rough={0.1} opacity={0.55} />
      <PlanBox x={5.82} y={0.93} w={0.26} d={0.38} h={1.32} color="#f4efe7" rough={0.32} />
      <PlanBox x={5.84} y={0.96} w={0.22} d={0.06} h={1.22} color="#7c3aed" emissive="#7c3aed" emI={1.9} rough={0.1} />

      <PlanBox x={7.15} y={0.88} w={0.34} d={4.65} h={0.86} color="#d2c9bd" rough={0.6} />
      <PlanBox x={9.25} y={0.88} w={0.34} d={4.65} h={0.86} color="#d2c9bd" rough={0.6} />
      {shelfRows.map((y) => (
        <PlanBox key={`tunel-shelf-left-${y}`} x={7.23} y={y} w={0.48} d={0.08} h={0.95} color="#b7aa9a" rough={0.55} />
      ))}
      {shelfRows.map((y) => (
        <PlanBox key={`tunel-shelf-right-${y}`} x={9.02} y={y} w={0.48} d={0.08} h={0.95} color="#b7aa9a" rough={0.55} />
      ))}
      <VerticalLed x={7.62} y={3.58} w={0.08} d={1.38} h={1.08} color="#38bdf8" intensity={1.9} label="TV ESQ" />
      <VerticalLed x={9.15} y={2.22} w={0.08} d={1.45} h={1.08} color="#38bdf8" intensity={1.9} label="TV DIR" />
      <VerticalLed x={9.78} y={1.24} w={0.08} d={5.22} h={1.05} color="#8b5cf6" intensity={1.5} label="PASSARELA LED" />
      <PlanBox x={8.28} y={0.78} w={0.84} d={0.16} h={0.65} color="#0ea5e9" emissive="#0ea5e9" emI={1.4} rough={0.2} />
      <PlanBox x={8.72} y={0.18} w={0.72} d={0.55} h={0.04} color="#f8fafc" rough={0.5} />

      <VerticalLed x={1.48} y={0.07} w={6.9} d={0.07} h={0.78} color="#a855f7" intensity={2.0} label="TESTEIRA LED" />
      <VerticalLed x={7.64} y={0.07} w={2.7} d={0.07} h={0.62} color="#a855f7" intensity={1.9} />
      <Col x={6.48} y={0.46} r={0.15} h={1.78} color="#eee8dd" />
      <Col x={9.96} y={0.46} r={0.15} h={1.78} color="#eee8dd" />
      <VerticalLed x={6.32} y={0.3} w={0.32} d={0.05} h={1.66} color="#c084fc" intensity={1.7} />
      <VerticalLed x={9.8} y={0.3} w={0.32} d={0.05} h={1.66} color="#c084fc" intensity={1.7} />
      <PlanBox x={5.08} y={5.52} w={2.25} d={0.36} h={0.08} color="#f6f2e8" rough={0.65} />

      <FloorPlanLabel text="BALCAO BAR" x={2.42} y={0.78} size={0.13} />
      <FloorPlanLabel text="DRINKS" x={3.72} y={1.72} size={0.14} />
      <FloorPlanLabel text="DEPOSITO" x={4.2} y={4.35} size={0.13} />
      <FloorPlanLabel text="ENTRADA LOJA" x={3.28} y={4.1} size={0.15} />
      <FloorPlanLabel text="CHECK OUT" x={4.38} y={6.38} size={0.12} />
      <FloorPlanLabel text="CAIXA" x={6.55} y={7.25} size={0.16} />
      <FloorPlanLabel text="TUNEL" x={8.63} y={4.25} size={0.16} />
      <FloorPlanLabel text="ENTRADA TUNEL" x={9.08} y={1.18} size={0.12} />
    </>
  );
}

function HeatCircle({ cp, visible }: { cp: ContactPoint; visible: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const v = cp.heatValue ?? 0.5;
  const color = heatColor(v);
  const [px, , pz] = S(cp.pos[0], cp.pos[1]);
  const radius = 0.3 + v * 0.85;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    const s = 1 + Math.sin(t * 1.4 + cp.pos[0]) * 0.08;
    ref.current.scale.set(s, 1, s);
    (ref.current.material as THREE.MeshStandardMaterial).opacity =
      visible ? 0.2 + Math.sin(t * 2.2) * 0.06 : 0;
  });

  return (
    <mesh ref={ref} position={[px, 0.012, pz]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 32]} />
      <meshStandardMaterial color={color} transparent opacity={0.2} depthWrite={false} />
    </mesh>
  );
}

// ── Camera marker ──────────────────────────────────────────────────────────────

function useAppThemeMode(): 'dark' | 'light' {
  const readTheme = (): 'dark' | 'light' => {
    try {
      if (document.documentElement.dataset.appTheme === 'light') return 'light';
      if (document.documentElement.dataset.appTheme === 'dark') return 'dark';
      return localStorage.getItem('app-theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  };
  const [theme, setTheme] = useState<'dark' | 'light'>(readTheme);

  useEffect(() => {
    const update = () => setTheme(readTheme());
    window.addEventListener('app-theme-change', update);
    window.addEventListener('dashboard-theme-change', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-app-theme', 'class'] });
    return () => {
      window.removeEventListener('app-theme-change', update);
      window.removeEventListener('dashboard-theme-change', update);
      observer.disconnect();
    };
  }, []);

  return theme;
}

function CameraMarker({ cp, selected, onClick, onHover, showLabels }: {
  cp: ContactPoint; selected: boolean; onClick: () => void; onHover: (hovered: boolean) => void; showLabels: boolean;
}) {
  const sRef = useRef<THREE.Mesh>(null);
  const rRef = useRef<THREE.Mesh>(null);
  const color = heatColor(cp.heatValue ?? 0.5);
  const [px, , pz] = S(cp.pos[0], cp.pos[1]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (sRef.current) sRef.current.position.y = 0.48 + Math.sin(t * 1.8 + cp.pos[0]) * 0.05;
    if (rRef.current) {
      rRef.current.rotation.y = t * 0.8;
      const sc = selected ? 1 + Math.sin(t * 3) * 0.1 : 1;
      rRef.current.scale.set(sc, sc, sc);
    }
  });

  return (
    <group
      position={[px, 0, pz]}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerEnter={(e) => { e.stopPropagation(); onHover(true); document.body.style.cursor = 'pointer'; }}
      onPointerLeave={(e) => { e.stopPropagation(); onHover(false); document.body.style.cursor = ''; }}
    >
      <mesh ref={rRef} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.14, 0.22, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 3 : 1} transparent opacity={0.75} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.23, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.44, 8]} />
        <meshStandardMaterial color="#374151" roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh ref={sRef} position={[0, 0.48, 0]}>
        <sphereGeometry args={[selected ? 0.11 : 0.08, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 4 : 2} roughness={0.15} metalness={0.3} />
      </mesh>
      {showLabels && (
        <Html position={[0, 0.85, 0]} center zIndexRange={[0, 100]} style={{ pointerEvents: 'auto' }}>
          <div
            onMouseEnter={() => { onHover(true); document.body.style.cursor = 'pointer'; }}
            onMouseLeave={() => { onHover(false); document.body.style.cursor = ''; }}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            style={{
            whiteSpace: 'nowrap', fontSize: 9, fontWeight: 700,
            padding: '2px 7px', borderRadius: 99,
            border: `1px solid ${color}70`,
            background: selected ? color : 'rgba(255,255,255,0.96)',
            color: selected ? '#fff' : '#1f2937',
            cursor: 'pointer',
            boxShadow: selected ? `0 2px 10px ${color}60` : '0 1px 4px rgba(0,0,0,0.15)',
          }}>
            {cp.name}
          </div>
        </Html>
      )}
    </group>
  );
}

// ── Info panel ─────────────────────────────────────────────────────────────────

function InfoPanel({ cp, onClose, onHover, light }: {
  cp: ContactPoint; onClose: () => void; onHover: (hovered: boolean) => void; light: boolean;
}) {
  const [px, , pz] = S(cp.pos[0], cp.pos[1]);
  const color = heatColor(cp.heatValue ?? 0.5);
  return (
    <Html position={[px, 1.5, pz]} center distanceFactor={8} zIndexRange={[10, 200]}>
      <div
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        style={{
        width: 172, borderRadius: 12, border: `1px solid ${color}50`,
        background: light ? 'rgba(255,255,255,0.98)' : '#0d1117',
        padding: 10,
        boxShadow: light ? '0 10px 28px rgba(15,23,42,0.16)' : `0 4px 20px ${color}20`,
        fontSize: 11,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
          <span style={{ fontWeight: 700, color: light ? '#0f172a' : '#fff' }}>{cp.icon} {cp.name}</span>
          <button onClick={onClose} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: light ? '#475569' : '#6b7280' }}>Fluxo</span>
          <span style={{ fontWeight: 600, color }}>{cp.flowCount?.toLocaleString('pt-BR') ?? '—'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: light ? '#475569' : '#6b7280' }}>Calor</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 48, height: 5, borderRadius: 99, background: light ? '#e2e8f0' : '#1f2937', overflow: 'hidden' }}>
              <div style={{ width: `${(cp.heatValue ?? 0) * 100}%`, height: '100%', background: color, borderRadius: 99 }} />
            </div>
            <span style={{ fontWeight: 600, color, fontSize: 10 }}>{Math.round((cp.heatValue ?? 0) * 100)}%</span>
          </div>
        </div>
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${light ? '#e2e8f0' : '#1f2937'}`, color: light ? '#64748b' : '#6b7280', fontSize: 10 }}>
          Posicao: {cp.pos[0].toFixed(2)}, {cp.pos[1].toFixed(2)}
        </div>
      </div>
    </Html>
  );
}

// ── Flow lines ─────────────────────────────────────────────────────────────────

const FLOW_ROUTES: [string, string][] = [
  ['entrada_loja', 'caixa'],
  ['entrada_loja', 'prat_virtual'],
  ['entrada_loja', 'drinks'],
  ['entrada_loja', 'megabanner'],
  ['entrada_loja', 'quina_3d'],
  ['entrada_tunel', 'tv_tunel_esq'],
  ['entrada_tunel', 'tv_tunel_dir'],
  ['entrada_tunel', 'olobox'],
  ['drinks', 'caixa'],
  ['prat_virtual', 'caixa'],
];

function FlowLine({ from, to, count }: { from: ContactPoint; to: ContactPoint; count: number }) {
  const color = heatColor(Math.min(count / 1200, 1));
  const pts = useMemo((): [number, number, number][] => {
    const [fx, , fz] = S(from.pos[0], from.pos[1]);
    const [tx, , tz] = S(to.pos[0], to.pos[1]);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(fx, 0.05, fz),
      new THREE.Vector3((fx + tx) / 2, 0.05, (fz + tz) / 2),
      new THREE.Vector3(tx, 0.05, tz),
    );
    return curve.getPoints(20).map((p) => [p.x, p.y, p.z]);
  }, [from.pos, to.pos]);
  return <Line points={pts} color={color} lineWidth={1.2} transparent opacity={0.38} />;
}

// ── Scene root ─────────────────────────────────────────────────────────────────

function StoreScene({ contacts, selectedId, hoveredId, onSelect, onHover, showHeat, showLabels, showFlow, light }: {
  contacts: ContactPoint[]; selectedId: string | null; hoveredId: string | null; onSelect: (id: string | null) => void; onHover: (id: string | null) => void;
  showHeat: boolean; showLabels: boolean; showFlow: boolean; light: boolean;
}) {
  const cpMap = useMemo(() => {
    const m: Record<string, ContactPoint> = {};
    contacts.forEach((c) => { m[c.id] = c; });
    return m;
  }, [contacts]);
  const sel = (selectedId ? cpMap[selectedId] : null) ?? (hoveredId ? cpMap[hoveredId] : null) ?? null;

  return (
    <>
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#fff5e0', '#d4cdbf', 0.8]} />
      <directionalLight position={[5, 14, 6]} intensity={0.9} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-4, 10, -6]} intensity={0.4} color="#ffffff" />
      <pointLight position={[0, 3, 0]} intensity={0.4} color="#a78bfa" distance={15} />
      <pointLight position={[-4, 2, 2]} intensity={0.2} color="#c4b5fd" distance={8} />
      <pointLight position={[4, 2, -2]} intensity={0.2} color="#a5b4fc" distance={8} />

      <AccurateStoreGeometry />

      {contacts.map((cp) => <HeatCircle key={cp.id} cp={cp} visible={showHeat} />)}

      {showFlow && FLOW_ROUTES.map(([a, b]) => {
        const f = cpMap[a], t = cpMap[b];
        return f && t ? <FlowLine key={`${a}-${b}`} from={f} to={t} count={Math.max(f.flowCount ?? 0, t.flowCount ?? 0)} /> : null;
      })}

      {contacts.map((cp) => (
        <CameraMarker key={cp.id} cp={cp} selected={selectedId === cp.id}
          onClick={() => onSelect(selectedId === cp.id ? null : cp.id)}
          onHover={(hovered) => onHover(hovered ? cp.id : null)}
          showLabels={showLabels} />
      ))}

      {sel && <InfoPanel cp={sel} onClose={() => onSelect(null)} onHover={(hovered) => onHover(hovered ? sel.id : null)} light={light} />}

      <OrbitControls makeDefault enablePan enableZoom enableRotate
        minPolarAngle={0.1} maxPolarAngle={Math.PI / 2.05}
        minDistance={3} maxDistance={24} target={[0, 0, 0]} />
    </>
  );
}

// ── Exported component ─────────────────────────────────────────────────────────

export function StorePlan3D({ contacts = LED_CONTACT_POINTS }: { contacts?: ContactPoint[] }) {
  const [showHeat,   setShowHeat]   = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showFlow,   setShowFlow]   = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverClearTimer = useRef<number | null>(null);
  const light = useAppThemeMode() === 'light';

  const handleHover = (id: string | null) => {
    if (hoverClearTimer.current) {
      window.clearTimeout(hoverClearTimer.current);
      hoverClearTimer.current = null;
    }
    if (id) {
      setHoveredId(id);
      return;
    }
    hoverClearTimer.current = window.setTimeout(() => {
      setHoveredId(null);
      hoverClearTimer.current = null;
    }, 220);
  };

  const btnStyle = (on: boolean): React.CSSProperties => ({
    fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 8,
    border: 'none', cursor: 'pointer',
    background: on ? '#7c3aed' : light ? '#f1f5f9' : 'rgba(255,255,255,0.06)',
    color: on ? '#fff' : light ? '#475569' : '#9ca3af',
  });

  const overlay: React.CSSProperties = {
    position: 'absolute', zIndex: 10,
    background: light ? 'rgba(255,255,255,0.92)' : 'rgba(13,17,23,0.88)',
    border: light ? '1px solid rgba(148,163,184,0.35)' : '1px solid #1f2937',
    borderRadius: 10, padding: '5px 10px', backdropFilter: 'blur(8px)',
    boxShadow: light ? '0 8px 20px rgba(15,23,42,0.08)' : undefined,
  };

  return (
    <div style={{ background: light ? '#ffffff' : '#0d1117', border: `1px solid ${light ? '#cbd5e1' : '#1f2937'}`, borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ position: 'relative', height: 560 }}>

        {/* Badge */}
        <div style={{ ...overlay, top: 12, left: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', display: 'inline-block' }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: light ? '#334155' : '#d1d5db', letterSpacing: 2, textTransform: 'uppercase' as const }}>
            The LED · Planta 3D
          </span>
        </div>

        {/* Toolbar */}
        <div style={{ ...overlay, top: 12, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4 }}>
          <button type="button" onClick={() => setShowHeat(v=>!v)} style={btnStyle(showHeat)}>Calor</button>
          <button type="button" onClick={() => setShowLabels(v=>!v)} style={btnStyle(showLabels)}>Labels</button>
          <button type="button" onClick={() => setShowFlow(v=>!v)} style={btnStyle(showFlow)}>Fluxo</button>
        </div>

        {/* Heat legend */}
        {showHeat && (
          <div style={{ ...overlay, bottom: 12, left: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: light ? '#334155' : '#9ca3af' }}>Fluxo:</span>
            {['#3b82f6', '#10b981', '#f59e0b', '#ef4444'].map(c => (
              <div key={c} style={{ width: 16, height: 7, background: c, borderRadius: 3 }} />
            ))}
            <span style={{ fontSize: 9, color: light ? '#64748b' : '#6b7280' }}>Baixo / Alto</span>
          </div>
        )}

        {/* Point count */}
        <div style={{ ...overlay, bottom: 12, right: 12, fontSize: 10, color: light ? '#334155' : '#9ca3af' }}>
          <span style={{ fontWeight: 700, color: '#a78bfa' }}>{contacts.length}</span> pontos
        </div>

        <Canvas shadows camera={{ position: [0, 13, 9], fov: 40 }}
          style={{ width: '100%', height: '100%', background: light ? 'linear-gradient(180deg,#f8fafc,#e2e8f0)' : 'linear-gradient(180deg,#f7f3ea,#e6dfd0)' }}>
          <fog attach="fog" args={[light ? '#f8fafc' : '#f7f3ea', 25, 45]} />
          <StoreScene contacts={contacts} selectedId={selectedId} hoveredId={hoveredId} onSelect={setSelectedId} onHover={handleHover}
            showHeat={showHeat} showLabels={showLabels} showFlow={showFlow} light={light} />
        </Canvas>
      </div>

      {/* Contact list */}
      <div style={{ borderTop: `1px solid ${light ? '#e2e8f0' : '#1f2937'}`, padding: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: light ? '#64748b' : '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 2, marginBottom: 8 }}>
          Pontos de Contato
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(195px,1fr))', gap: 6 }}>
          {contacts.map(cp => {
            const c = heatColor(cp.heatValue ?? 0);
            const on = selectedId === cp.id;
            return (
              <button
                key={cp.id}
                type="button"
                onClick={() => setSelectedId(on ? null : cp.id)}
                onMouseEnter={() => handleHover(cp.id)}
                onMouseLeave={() => handleHover(null)}
                style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 10,
                textAlign: 'left' as const, cursor: 'pointer',
                border: `1px solid ${on ? '#7c3aed80' : light ? '#e2e8f0' : '#1f2937'}`,
                background: on ? '#7c3aed18' : light ? '#ffffff' : 'transparent',
              }}>
                <span style={{ fontSize: 14 }}>{cp.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: light ? '#0f172a' : '#e5e7eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{cp.name}</div>
                  <div style={{ fontSize: 9, color: light ? '#64748b' : '#6b7280' }}>{cp.flowCount?.toLocaleString('pt-BR')} visit.</div>
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: c, flexShrink: 0 }}>{Math.round((cp.heatValue ?? 0) * 100)}%</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

