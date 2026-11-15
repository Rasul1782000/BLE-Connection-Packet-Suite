import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Box,
  ChevronDown,
  ChevronUp,
  Compass,
  Eye,
  Mail,
  RotateCw,
  Wifi,
} from 'lucide-react';
import type { PacketTelemetry } from '../types/bluetooth';
import { RssiText } from './RssiText';

interface BleTopology3DProps {
  devices: PacketTelemetry[];
  latestPacket: PacketTelemetry | null;
  selectedDeviceId: string | null;
  onSelectDevice: (deviceId: string | null) => void;
  onQuickConnectToggle: (device: PacketTelemetry) => void;
}

type CameraPreset = 'isometric' | 'box-pov' | 'top';
type DeviceArchetype = 'laptop' | 'mouse' | 'watch' | 'mobile' | 'keyboard' | 'sensor';

const ARCHETYPE_LABELS: Record<DeviceArchetype, string> = {
  laptop: 'Laptop',
  mouse: 'Mouse',
  watch: 'Smartwatch',
  mobile: 'Mobile Phone',
  keyboard: 'Keyboard',
  sensor: 'BLE Sensor',
};

interface PeripheralNode {
  deviceId: string;
  archetype: DeviceArchetype;
  group: THREE.Group;
  bodyGroup: THREE.Group;
  animatedPart: THREE.Object3D | null;
  ledMat: THREE.MeshStandardMaterial;
  padRingMat: THREE.MeshStandardMaterial;
  hitProxy: THREE.Mesh;
  linkTube: THREE.Mesh;
  linkTubeMat: THREE.MeshBasicMaterial;
  guideLine: THREE.Line;
  guideMat: THREE.LineBasicMaterial;
  targetPos: THREE.Vector3;
  emitterWorldPos: THREE.Vector3;
  emitterLocalY: number;
  curve: THREE.CatmullRomCurve3;
  isConnected: boolean;
  isHandshaking: boolean;
  isFailed: boolean;
  spawnScale: number;
  activityImpulse: number;
  lastLinkStart: THREE.Vector3;
  lastLinkEnd: THREE.Vector3;
}

interface EmailPacketPulse {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  curve: THREE.CatmullRomCurve3;
  reverse: boolean;
  progress: number;
  speed: number;
  spinSign: number;
}

interface PairingWaveArc {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  start: THREE.Vector3;
  end: THREE.Vector3;
  progress: number;
  speed: number;
}

const BOX_ANCHOR = new THREE.Vector3(-4.2, 0, 0);
const _boxEmitterWorld = new THREE.Vector3(-3.2, 1.35, 0);
const _orbitFocus = new THREE.Vector3(0.4, 0.85, 0);

const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vTan = new THREE.Vector3();
const _vMid = new THREE.Vector3();
const _lookDir = new THREE.Vector3();
const _camTarget = new THREE.Vector3();

const STATE_COLORS = {
  connected: new THREE.Color(0x22c55e),
  handshaking: new THREE.Color(0xf59e0b),
  failed: new THREE.Color(0xef4444),
  advertising: new THREE.Color(0x38bdf8),
};

function createRoundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);

  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

export function classifyDeviceArchetype(device: PacketTelemetry): DeviceArchetype {
  const lower = (device.device_name || '').toLowerCase();
  const services = (device.gatt_services || []).join(' ').toLowerCase();

  if (
    lower.includes('laptop') ||
    lower.includes('macbook') ||
    lower.includes('thinkpad') ||
    lower.includes('notebook') ||
    lower.includes('xps') ||
    lower.includes('surface') ||
    lower.includes('ultrabook') ||
    lower.includes('chromebook') ||
    lower.includes('desktop') ||
    /\bpc\b/.test(lower)
  ) {
    return 'laptop';
  }
  if (
    lower.includes('mouse') ||
    lower.includes('mx master') ||
    lower.includes('trackpad') ||
    lower.includes('trackball')
  ) {
    return 'mouse';
  }
  if (
    lower.includes('watch') ||
    lower.includes('polar') ||
    lower.includes('heart') ||
    lower.includes('garmin') ||
    lower.includes('fitbit') ||
    lower.includes('whoop') ||
    lower.includes('band') ||
    services.includes('180d')
  ) {
    return 'watch';
  }
  if (
    lower.includes('mobile') ||
    lower.includes('phone') ||
    lower.includes('iphone') ||
    lower.includes('android') ||
    lower.includes('pixel') ||
    lower.includes('galaxy') ||
    lower.includes('samsung') ||
    lower.includes('oneplus') ||
    lower.includes('ipad') ||
    lower.includes('tablet')
  ) {
    return 'mobile';
  }
  if (lower.includes('keychron') || lower.includes('keyboard') || lower.includes('kbd')) {
    return 'keyboard';
  }
  return 'sensor';
}

function createStudioDeskTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#080a10';
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;

  const vignette = ctx.createRadialGradient(cx, cy, 40, cx, cy, size * 0.5);
  vignette.addColorStop(0, 'rgba(30, 58, 138, 0.16)');
  vignette.addColorStop(0.55, 'rgba(15, 23, 42, 0.22)');
  vignette.addColorStop(1, 'rgba(8, 10, 16, 0)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.065)';
  ctx.lineWidth = 1;
  const step = size / 20;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(size * 0.18, cy);
  ctx.lineTo(size * 0.88, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createGatewayBoxScreenTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#071022');
  grad.addColorStop(1, '#0c1a36');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, w - 20, h - 20);

  // Envelope + Bluetooth badge
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4;
  ctx.strokeRect(32, 62, 112, 76);
  ctx.beginPath();
  ctx.moveTo(32, 62);
  ctx.lineTo(88, 104);
  ctx.lineTo(144, 62);
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 28px sans-serif';
  ctx.fillText('BLE PACKET BOX', 168, 86);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '600 18px monospace';
  ctx.fillText('AUTO-DETECT & TX/RX', 168, 120);

  // Signal / queue bars
  const barColors = ['#22c55e', '#38bdf8', '#f59e0b'];
  barColors.forEach((col, i) => {
    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
    ctx.fillRect(32, 166 + i * 24, w - 64, 14);
    ctx.fillStyle = col;
    ctx.fillRect(32, 166 + i * 24, (w - 64) * (0.85 - i * 0.18), 14);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createEnvelopePacketTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, w, h);

  // Crisp envelope inner border
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  // Classic envelope flap V-fold
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(14, 14);
  ctx.lineTo(w / 2, h * 0.58);
  ctx.lineTo(w - 14, 14);
  ctx.stroke();

  // Lower side fold creases
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(14, h - 14);
  ctx.lineTo(w * 0.36, h * 0.45);
  ctx.moveTo(w - 14, h - 14);
  ctx.lineTo(w * 0.64, h * 0.45);
  ctx.stroke();

  // Postage / BLE seal stamp at center flap
  ctx.fillStyle = '#0ea5e9';
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.58, 18, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createLaptopScreenTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 320;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#091529');
  bg.addColorStop(1, '#070b14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '700 24px monospace';
  ctx.fillText('WORKSTATION BLE', 28, 48);

  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let x = 28; x <= w - 28; x += 24) {
    const y = 175 + Math.sin(x * 0.04) * 34;
    if (x === 28) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 18px monospace';
  ctx.fillText('GATT STREAM READY', 28, 275);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createWatchDialTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, size, size);

  const c = size / 2;
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(c, c, 94, -Math.PI * 0.65, Math.PI * 0.95);
  ctx.stroke();

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(c, c, 74, -Math.PI * 0.4, Math.PI * 0.7);
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 44px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('72', c, c + 12);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 18px monospace';
  ctx.fillText('BPM · BLE', c, c + 40);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createMobileScreenTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0b1830');
  bg.addColorStop(1, '#070b14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(w / 2, 185, 58, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#e0f2fe';
  ctx.font = '700 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MOBILE BLE', w / 2, 295);

  ctx.fillStyle = '#22c55e';
  ctx.fillRect(46, 340, 164, 18);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(46, 374, 128, 18);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildBluetoothGatewayBox(maxAnisotropy: number): {
  boxRoot: THREE.Group;
  emitterCap: THREE.Mesh;
  statusHaloMat: THREE.MeshBasicMaterial;
  boxScreenTex: THREE.CanvasTexture;
} {
  const boxRoot = new THREE.Group();
  boxRoot.position.copy(BOX_ANCHOR);

  const chassisMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.78,
    roughness: 0.3,
  });
  const titaniumMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.9,
    roughness: 0.2,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.45,
    roughness: 0.5,
  });

  // 1. Floor status ring halo around the Bluetooth Packet Box
  const statusHaloMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const statusHalo = new THREE.Mesh(
    new THREE.RingGeometry(1.48, 1.56, 48),
    statusHaloMat
  );
  statusHalo.rotation.x = -Math.PI / 2;
  statusHalo.position.y = 0.02;
  boxRoot.add(statusHalo);

  // 2. Four rubberized feet resting flush at y = 0
  const footGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.1, 16);
  [
    [-0.72, -0.52],
    [0.72, -0.52],
    [-0.72, 0.52],
    [0.72, 0.52],
  ].forEach(([fx, fz]) => {
    const foot = new THREE.Mesh(footGeo, darkMat);
    foot.position.set(fx, 0.05, fz);
    foot.castShadow = true;
    boxRoot.add(foot);
  });

  // 3. Main beveled Bluetooth Gateway Box housing (pivot above feet)
  const hullShape = createRoundedRectShape(1.56, 1.92, 0.16);
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 0.76,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 4,
  });
  hullGeo.rotateX(Math.PI / 2);
  hullGeo.center();
  const hull = new THREE.Mesh(hullGeo, chassisMat);
  hull.position.y = 0.52;
  hull.castShadow = true;
  hull.receiveShadow = true;
  boxRoot.add(hull);

  // 4. Brushed metallic top deck plate
  const topPlate = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.06, 1.72),
    titaniumMat
  );
  topPlate.position.y = 0.94;
  topPlate.castShadow = true;
  boxRoot.add(topPlate);

  // 5. Front-facing OLED Packet Dispatch Display (angled toward camera & peripherals)
  const boxScreenTex = createGatewayBoxScreenTexture();
  boxScreenTex.anisotropy = maxAnisotropy;
  const screenMat = new THREE.MeshStandardMaterial({
    map: boxScreenTex,
    emissive: 0x0ea5e9,
    emissiveMap: boxScreenTex,
    emissiveIntensity: 0.65,
    roughness: 0.14,
    metalness: 0.08,
  });
  const display = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.62), screenMat);
  display.position.set(0.84, 0.56, 0);
  display.rotation.y = Math.PI / 2;
  boxRoot.add(display);

  // 6. Side cooling fins
  const finGeo = new THREE.BoxGeometry(1.15, 0.04, 0.06);
  for (let i = 0; i < 4; i += 1) {
    const fin = new THREE.Mesh(finGeo, darkMat);
    fin.position.set(0, 0.34 + i * 0.13, 0.98);
    boxRoot.add(fin);
  }

  // 7 & 8. Dual RF Antenna Masts + Glowing Beacon Tips
  const antennaGeo = new THREE.CylinderGeometry(0.032, 0.045, 0.82, 14);
  const tipGeo = new THREE.SphereGeometry(0.065, 12, 12);
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  [-0.58, 0.58].forEach((az) => {
    const ant = new THREE.Mesh(antennaGeo, titaniumMat);
    ant.position.set(-0.52, 1.35, az);
    ant.castShadow = true;
    boxRoot.add(ant);

    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.set(-0.52, 1.79, az);
    boxRoot.add(tip);
  });

  // 9. Front RF Packet Dispatch Port / Launcher Nozzle (packets fly out from here!)
  const portHousing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.24, 0.18, 24),
    titaniumMat
  );
  portHousing.rotation.z = -Math.PI / 2;
  portHousing.position.set(0.86, 1.04, 0);
  boxRoot.add(portHousing);

  const emitterCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 16, 16),
    tipMat
  );
  emitterCap.position.set(0.98, 1.04, 0);
  boxRoot.add(emitterCap);

  return { boxRoot, emitterCap, statusHaloMat, boxScreenTex };
}

function buildPeripheralDeviceMesh(
  archetype: DeviceArchetype,
  shared: {
    matteShellMat: THREE.MeshStandardMaterial;
    brushedMetalMat: THREE.MeshStandardMaterial;
    darkTrimMat: THREE.MeshStandardMaterial;
    keycapMat: THREE.MeshStandardMaterial;
    ledMat: THREE.MeshStandardMaterial;
    laptopScreenMat: THREE.MeshStandardMaterial;
    watchDialMat: THREE.MeshStandardMaterial;
    mobileScreenMat: THREE.MeshStandardMaterial;
  }
): {
  bodyGroup: THREE.Group;
  animatedPart: THREE.Object3D | null;
  emitterLocalY: number;
} {
  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = 0.07;

  let animatedPart: THREE.Object3D | null = null;
  let emitterLocalY = 0.5;

  if (archetype === 'laptop') {
    // 1. Aluminum laptop lower base deck
    const baseDeck = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.07, 0.84),
      shared.brushedMetalMat
    );
    baseDeck.position.y = 0.05;
    baseDeck.castShadow = true;
    bodyGroup.add(baseDeck);

    // 2. Dark recessed keyboard & trackpad
    const kbPad = new THREE.Mesh(
      new THREE.BoxGeometry(0.96, 0.02, 0.42),
      shared.darkTrimMat
    );
    kbPad.position.set(0, 0.09, -0.06);
    bodyGroup.add(kbPad);

    const trackpad = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.015, 0.22),
      shared.matteShellMat
    );
    trackpad.position.set(0, 0.09, 0.27);
    bodyGroup.add(trackpad);

    // 3. Cylindrical screen hinge
    const hinge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, 0.92, 16),
      shared.darkTrimMat
    );
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(0, 0.095, -0.39);
    bodyGroup.add(hinge);

    // 4. Hinged display lid group (screen faces toward +Z, which lookAt aims toward Box)
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.095, -0.39);
    lidPivot.rotation.x = -0.22; // Open ~103 degrees
    bodyGroup.add(lidPivot);

    const lidShell = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.78, 0.045),
      shared.brushedMetalMat
    );
    lidShell.position.set(0, 0.39, 0);
    lidShell.castShadow = true;
    lidPivot.add(lidShell);

    const screenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.06, 0.66),
      shared.laptopScreenMat
    );
    screenMesh.position.set(0, 0.39, 0.026);
    lidPivot.add(screenMesh);

    const camLed = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 10, 10),
      shared.ledMat
    );
    camLed.position.set(0, 0.745, 0.028);
    lidPivot.add(camLed);

    animatedPart = lidPivot;
    emitterLocalY = 0.72;
  } else if (archetype === 'mouse') {
    const baseShape = createRoundedRectShape(0.62, 1.04, 0.26);
    const bodyGeo = new THREE.ExtrudeGeometry(baseShape, {
      depth: 0.2,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.05,
      bevelSegments: 4,
    });
    bodyGeo.rotateX(Math.PI / 2);
    const shell = new THREE.Mesh(bodyGeo, shared.matteShellMat);
    shell.position.y = 0.28;
    shell.castShadow = true;
    bodyGroup.add(shell);

    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.1, 0.56),
      shared.darkTrimMat
    );
    wing.position.set(-0.34, 0.06, 0.06);
    bodyGroup.add(wing);

    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.1, 20),
      shared.brushedMetalMat
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0, 0.35, -0.25);
    bodyGroup.add(wheel);

    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.03, 0.18),
      shared.ledMat
    );
    led.position.set(0, 0.37, -0.02);
    bodyGroup.add(led);

    animatedPart = wheel;
    emitterLocalY = 0.46;
  } else if (archetype === 'watch') {
    // Smartwatch cradle + case + curved straps + glowing dial
    const podGroup = new THREE.Group();
    bodyGroup.add(podGroup);

    const watchCase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.4, 0.16, 28),
      shared.brushedMetalMat
    );
    watchCase.position.y = 0.36;
    watchCase.rotation.x = 0.45; // Angled slightly toward Bluetooth box / viewer
    watchCase.castShadow = true;
    podGroup.add(watchCase);

    const dial = new THREE.Mesh(
      new THREE.CircleGeometry(0.31, 28),
      shared.watchDialMat
    );
    dial.position.set(0, 0.44, 0.04);
    dial.rotation.x = -Math.PI / 2 + 0.45;
    podGroup.add(dial);

    const ledRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.024, 10, 32),
      shared.ledMat
    );
    ledRing.position.set(0, 0.43, 0.035);
    ledRing.rotation.x = Math.PI / 2 + 0.45;
    podGroup.add(ledRing);

    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.09, 14),
      shared.brushedMetalMat
    );
    crown.rotation.z = Math.PI / 2;
    crown.position.set(0.41, 0.36, 0);
    podGroup.add(crown);

    [-1, 1].forEach((dir) => {
      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.06, 0.46),
        shared.matteShellMat
      );
      strap.position.set(0, 0.18, dir * 0.42);
      strap.rotation.x = dir * 0.55;
      strap.castShadow = true;
      bodyGroup.add(strap);
    });

    animatedPart = podGroup;
    emitterLocalY = 0.56;
  } else if (archetype === 'mobile') {
    // Smartphone peripheral on mini charging stand
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.24, 0.42),
      shared.darkTrimMat
    );
    stand.position.set(0, 0.12, -0.06);
    bodyGroup.add(stand);

    const phoneBody = new THREE.Group();
    phoneBody.position.set(0, 0.58, 0);
    phoneBody.rotation.x = -0.22;
    bodyGroup.add(phoneBody);

    const frameShape = createRoundedRectShape(0.56, 1.08, 0.09);
    const frameGeo = new THREE.ExtrudeGeometry(frameShape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 3,
    });
    frameGeo.center();
    const chassis = new THREE.Mesh(frameGeo, shared.brushedMetalMat);
    chassis.castShadow = true;
    phoneBody.add(chassis);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.96),
      shared.mobileScreenMat
    );
    screen.position.z = 0.048;
    phoneBody.add(screen);

    const statusBarLed = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.025, 0.02),
      shared.ledMat
    );
    statusBarLed.position.set(0, 0.45, 0.05);
    phoneBody.add(statusBarLed);

    animatedPart = phoneBody;
    emitterLocalY = 0.96;
  } else if (archetype === 'keyboard') {
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.12, 0.62),
      shared.brushedMetalMat
    );
    deck.position.y = 0.12;
    deck.rotation.x = 0.12;
    deck.castShadow = true;
    bodyGroup.add(deck);

    const keyGeo = new THREE.BoxGeometry(0.11, 0.065, 0.1);
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const key = new THREE.Mesh(keyGeo, shared.keycapMat);
        key.position.set(
          -0.42 + c * 0.14,
          0.19 + (1.5 - r) * 0.015,
          -0.18 + r * 0.12
        );
        key.rotation.x = 0.12;
        bodyGroup.add(key);
      }
    }

    const ledBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.03, 0.03),
      shared.ledMat
    );
    ledBar.position.set(0, 0.21, -0.29);
    ledBar.rotation.x = 0.12;
    bodyGroup.add(ledBar);

    animatedPart = ledBar;
    emitterLocalY = 0.42;
  } else {
    const housingShape = createRoundedRectShape(0.74, 0.74, 0.18);
    const housingGeo = new THREE.ExtrudeGeometry(housingShape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.035,
      bevelSize: 0.035,
      bevelSegments: 3,
    });
    housingGeo.rotateX(Math.PI / 2);
    const housing = new THREE.Mesh(housingGeo, shared.matteShellMat);
    housing.position.y = 0.26;
    housing.castShadow = true;
    bodyGroup.add(housing);

    const bezel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 0.06, 24),
      shared.brushedMetalMat
    );
    bezel.position.y = 0.32;
    bodyGroup.add(bezel);

    const statusCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 18, 14),
      shared.ledMat
    );
    statusCore.position.y = 0.36;
    bodyGroup.add(statusCore);

    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.032, 0.36, 12),
      shared.brushedMetalMat
    );
    antenna.position.set(0.26, 0.44, -0.24);
    antenna.castShadow = true;
    bodyGroup.add(antenna);

    animatedPart = statusCore;
    emitterLocalY = 0.54;
  }

  return { bodyGroup, animatedPart, emitterLocalY };
}

function getArcPlacement(
  rssi: number,
  index: number,
  total: number
): THREE.Vector3 {
  const clamped = Math.max(-95, Math.min(-35, rssi));
  const t = (-35 - clamped) / 60;
  const radialDistance = 4.6 + t * 5.0;

  const spread = total <= 1 ? 0 : Math.min(Math.PI * 0.74, (total - 1) * 0.38);
  const angle = total <= 1 ? 0 : -spread / 2 + (index / (total - 1)) * spread;

  const x = BOX_ANCHOR.x + Math.cos(angle) * radialDistance;
  const z = Math.sin(angle) * radialDistance;
  return new THREE.Vector3(x, 0, z);
}

function buildLinkCurve(
  start: THREE.Vector3,
  end: THREE.Vector3,
  curve: THREE.CatmullRomCurve3
) {
  _vMid.addVectors(start, end).multiplyScalar(0.5);
  const span = start.distanceTo(end);
  _vMid.y = Math.max(start.y, end.y) + 0.7 + span * 0.16;
  curve.points[0].copy(start);
  curve.points[1].copy(_vMid);
  curve.points[2].copy(end);
}

function disposeObjectTree(root: THREE.Object3D) {
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      m.geometry?.dispose();
    }
  });
}

export const BleTopology3D: React.FC<BleTopology3DProps> = ({
  devices,
  latestPacket,
  selectedDeviceId,
  onSelectDevice,
  onQuickConnectToggle,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('isometric');
  const [contextLost, setContextLost] = useState(false);

  const devicesRef = useRef<PacketTelemetry[]>(devices);
  devicesRef.current = devices;

  const selectedIdRef = useRef<string | null>(selectedDeviceId);
  selectedIdRef.current = selectedDeviceId;

  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  const presetTriggerRef = useRef<CameraPreset | null>(null);
  const onSelectRef = useRef(onSelectDevice);
  onSelectRef.current = onSelectDevice;

  const pulseQueueRef = useRef<PacketTelemetry[]>([]);

  useEffect(() => {
    if (latestPacket) {
      pulseQueueRef.current.push(latestPacket);
      if (pulseQueueRef.current.length > 24) {
        pulseQueueRef.current.shift();
      }
    }
  }, [latestPacket]);

  const applyCameraPreset = (preset: CameraPreset) => {
    setCameraPreset(preset);
    presetTriggerRef.current = preset;
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const width = container.clientWidth || 960;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080a10);
    scene.fog = new THREE.FogExp2(0x080a10, 0.02);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 120);
    camera.position.set(1.4, 5.6, 11.4);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();

    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x09090b, 0.8);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.85);
    keyLight.position.set(6, 11, 8);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 32;
    keyLight.shadow.camera.left = -11;
    keyLight.shadow.camera.right = 11;
    keyLight.shadow.camera.top = 11;
    keyLight.shadow.camera.bottom = -11;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.95);
    rimLight.position.set(-8, 6, -8);
    scene.add(rimLight);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const deskTex = createStudioDeskTexture();
    deskTex.anisotropy = maxAnisotropy;
    const deskMat = new THREE.MeshStandardMaterial({
      map: deskTex,
      roughness: 0.78,
      metalness: 0.16,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const deskMesh = new THREE.Mesh(new THREE.PlaneGeometry(34, 24), deskMat);
    deskMesh.rotation.x = -Math.PI / 2;
    deskMesh.position.y = -0.01;
    deskMesh.receiveShadow = true;
    scene.add(deskMesh);

    // Build Hero Bluetooth Packet Gateway Box
    const { boxRoot, emitterCap, statusHaloMat, boxScreenTex } =
      buildBluetoothGatewayBox(maxAnisotropy);
    scene.add(boxRoot);
    boxRoot.updateMatrixWorld(true);
    emitterCap.getWorldPosition(_boxEmitterWorld);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.06;
    controls.minDistance = 4.5;
    controls.maxDistance = 24;
    controls.target.copy(_orbitFocus);
    controls.autoRotate = !isSoftwareGl && autoRotateRef.current;
    controls.autoRotateSpeed = 0.45;

    let transitionGoal: THREE.Vector3 | null = null;
    controls.addEventListener('start', () => {
      transitionGoal = null;
    });

    // Shared device materials & textures
    const envelopeTex = createEnvelopePacketTexture();
    envelopeTex.anisotropy = maxAnisotropy;

    const laptopScreenTex = createLaptopScreenTexture();
    laptopScreenTex.anisotropy = maxAnisotropy;
    const watchDialTex = createWatchDialTexture();
    watchDialTex.anisotropy = maxAnisotropy;
    const mobileScreenTex = createMobileScreenTexture();
    mobileScreenTex.anisotropy = maxAnisotropy;

    const matteShellMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.52,
      metalness: 0.24,
    });
    const brushedMetalMat = new THREE.MeshStandardMaterial({
      color: 0xa1a1aa,
      roughness: 0.22,
      metalness: 0.88,
    });
    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.42,
      metalness: 0.35,
    });
    const keycapMat = new THREE.MeshStandardMaterial({
      color: 0x3f3f46,
      roughness: 0.65,
      metalness: 0.08,
    });
    const padBaseMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.48,
      metalness: 0.62,
    });

    const laptopScreenMat = new THREE.MeshStandardMaterial({
      map: laptopScreenTex,
      emissive: 0x0284c7,
      emissiveMap: laptopScreenTex,
      emissiveIntensity: 0.6,
      roughness: 0.14,
    });
    const watchDialMat = new THREE.MeshStandardMaterial({
      map: watchDialTex,
      emissive: 0x22c55e,
      emissiveMap: watchDialTex,
      emissiveIntensity: 0.65,
      roughness: 0.12,
    });
    const mobileScreenMat = new THREE.MeshStandardMaterial({
      map: mobileScreenTex,
      emissive: 0x0ea5e9,
      emissiveMap: mobileScreenTex,
      emissiveIntensity: 0.65,
      roughness: 0.12,
    });

    const hitGeo = new THREE.SphereGeometry(0.98, 10, 10);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });

    // Shared 3D Email / Packet Envelope geometry (flat chamfered mail packet facing +Y/+Z)
    const envelopeGeo = new THREE.BoxGeometry(0.38, 0.055, 0.25);

    const waveArcGeo = new THREE.TorusGeometry(0.32, 0.022, 8, 28, Math.PI * 0.68);
    waveArcGeo.rotateZ(-Math.PI * 0.34);

    const nodesMap = new Map<string, PeripheralNode>();
    const activePackets: EmailPacketPulse[] = [];
    const activeWaves: PairingWaveArc[] = [];
    const clickables: THREE.Object3D[] = [];

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(clickables, false);
      if (hits.length > 0) {
        const hitId = hits[0].object.userData.deviceId as string | undefined;
        if (hitId) {
          onSelectRef.current(selectedIdRef.current === hitId ? null : hitId);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const spawnPairingWave = (
      targetWorldPos: THREE.Vector3,
      color: THREE.Color,
      speed = 1.1
    ) => {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(waveArcGeo, mat);
      mesh.position.copy(_boxEmitterWorld);
      _lookDir.subVectors(targetWorldPos, _boxEmitterWorld);
      mesh.lookAt(
        _boxEmitterWorld.x + _lookDir.x,
        _boxEmitterWorld.y + _lookDir.y,
        _boxEmitterWorld.z + _lookDir.z
      );
      scene.add(mesh);

      activeWaves.push({
        mesh,
        mat,
        start: _boxEmitterWorld.clone(),
        end: targetWorldPos.clone(),
        progress: 0,
        speed,
      });
    };

    const spawnEnvelopePacket = (
      rec: PeripheralNode,
      color: THREE.Color,
      outgoingFromBox: boolean,
      speed = 0.95
    ) => {
      const pMat = new THREE.MeshStandardMaterial({
        map: envelopeTex,
        color: 0xffffff,
        emissive: color,
        emissiveIntensity: 0.45,
        roughness: 0.35,
        metalness: 0.1,
        transparent: true,
        opacity: 0.98,
      });
      const pMesh = new THREE.Mesh(envelopeGeo, pMat);
      pMesh.castShadow = !isSoftwareGl;
      pMesh.position.copy(outgoingFromBox ? _boxEmitterWorld : rec.emitterWorldPos);
      scene.add(pMesh);

      activePackets.push({
        mesh: pMesh,
        mat: pMat,
        curve: rec.curve,
        reverse: !outgoingFromBox,
        progress: 0,
        speed,
        spinSign: outgoingFromBox ? 1 : -1,
      });
    };

    const syncNodes = () => {
      const list = devicesRef.current;
      const activeIds = new Set(list.map((d) => d.device_id));

      for (const [id, rec] of nodesMap.entries()) {
        if (!activeIds.has(id)) {
          scene.remove(rec.group);
          scene.remove(rec.linkTube);
          scene.remove(rec.guideLine);
          disposeObjectTree(rec.group);
          rec.ledMat.dispose();
          rec.padRingMat.dispose();
          rec.linkTubeMat.dispose();
          rec.linkTube.geometry.dispose();
          rec.guideMat.dispose();
          rec.guideLine.geometry.dispose();
          const idx = clickables.indexOf(rec.hitProxy);
          if (idx >= 0) clickables.splice(idx, 1);
          nodesMap.delete(id);
        }
      }

      list.forEach((dev, index) => {
        const targetPos = getArcPlacement(dev.rssi, index, list.length);
        const detectedArchetype = classifyDeviceArchetype(dev);
        let rec = nodesMap.get(dev.device_id);

        if (!rec) {
          const ledMat = new THREE.MeshStandardMaterial({
            color: 0x38bdf8,
            emissive: 0x0284c7,
            emissiveIntensity: 1.4,
            roughness: 0.25,
            metalness: 0.2,
          });
          const padRingMat = new THREE.MeshStandardMaterial({
            color: 0x38bdf8,
            emissive: 0x0ea5e9,
            emissiveIntensity: 0.85,
            roughness: 0.25,
            metalness: 0.6,
          });

          const group = new THREE.Group();
          const pad = new THREE.Mesh(
            new THREE.CylinderGeometry(0.78, 0.86, 0.07, 32),
            padBaseMat
          );
          pad.position.y = 0.035;
          pad.receiveShadow = true;
          pad.castShadow = true;
          group.add(pad);

          const padRing = new THREE.Mesh(
            new THREE.TorusGeometry(0.82, 0.025, 10, 40),
            padRingMat
          );
          padRing.rotation.x = Math.PI / 2;
          padRing.position.y = 0.07;
          group.add(padRing);

          const { bodyGroup, animatedPart, emitterLocalY } = buildPeripheralDeviceMesh(
            detectedArchetype,
            {
              matteShellMat,
              brushedMetalMat,
              darkTrimMat,
              keycapMat,
              ledMat,
              laptopScreenMat,
              watchDialMat,
              mobileScreenMat,
            }
          );
          group.add(bodyGroup);
          group.position.copy(targetPos);
          group.scale.setScalar(0.05);
          group.lookAt(BOX_ANCHOR.x, 0, BOX_ANCHOR.z);

          const hitProxy = new THREE.Mesh(hitGeo, hitMat);
          hitProxy.position.y = 0.45;
          hitProxy.userData.deviceId = dev.device_id;
          group.add(hitProxy);
          clickables.push(hitProxy);

          const emitterWorldPos = new THREE.Vector3(
            targetPos.x,
            emitterLocalY,
            targetPos.z
          );
          const curve = new THREE.CatmullRomCurve3([
            _boxEmitterWorld.clone(),
            new THREE.Vector3(),
            emitterWorldPos.clone(),
          ]);
          buildLinkCurve(_boxEmitterWorld, emitterWorldPos, curve);

          const tubeGeo = new THREE.TubeGeometry(curve, 28, 0.022, 8, false);
          const linkTubeMat = new THREE.MeshBasicMaterial({
            color: 0x22c55e,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          });
          const linkTube = new THREE.Mesh(tubeGeo, linkTubeMat);

          const guideGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
          const guideMat = new THREE.LineBasicMaterial({
            color: 0x38bdf8,
            transparent: true,
            opacity: 0.24,
          });
          const guideLine = new THREE.Line(guideGeo, guideMat);

          scene.add(linkTube);
          scene.add(guideLine);
          scene.add(group);

          rec = {
            deviceId: dev.device_id,
            archetype: detectedArchetype,
            group,
            bodyGroup,
            animatedPart,
            ledMat,
            padRingMat,
            hitProxy,
            linkTube,
            linkTubeMat,
            guideLine,
            guideMat,
            targetPos,
            emitterWorldPos,
            emitterLocalY,
            curve,
            isConnected: dev.is_connected,
            isHandshaking: dev.packet_type === 'CONN_REQ_SENT',
            isFailed: dev.packet_type === 'CONN_FAILED',
            spawnScale: 0.05,
            activityImpulse: 1.0,
            lastLinkStart: _boxEmitterWorld.clone(),
            lastLinkEnd: emitterWorldPos.clone(),
          };
          nodesMap.set(dev.device_id, rec);

          // Immediately fire discovery wave & email packet when a new device is detected
          spawnPairingWave(emitterWorldPos, STATE_COLORS.advertising, 1.15);
          spawnEnvelopePacket(rec, STATE_COLORS.advertising, true, 1.05);
        } else if (rec.archetype !== detectedArchetype) {
          // Rebuild device 3D silhouette if newly discovered GATT services/name refine its category
          rec.group.remove(rec.bodyGroup);
          disposeObjectTree(rec.bodyGroup);
          const rebuilt = buildPeripheralDeviceMesh(detectedArchetype, {
            matteShellMat,
            brushedMetalMat,
            darkTrimMat,
            keycapMat,
            ledMat: rec.ledMat,
            laptopScreenMat,
            watchDialMat,
            mobileScreenMat,
          });
          rec.bodyGroup = rebuilt.bodyGroup;
          rec.animatedPart = rebuilt.animatedPart;
          rec.emitterLocalY = rebuilt.emitterLocalY;
          rec.archetype = detectedArchetype;
          rec.activityImpulse = 1.0;
          rec.group.add(rec.bodyGroup);
        }

        rec.targetPos.copy(targetPos);
        rec.isConnected = dev.is_connected;
        rec.isHandshaking = dev.packet_type === 'CONN_REQ_SENT';
        rec.isFailed = dev.packet_type === 'CONN_FAILED';

        const stateColor = rec.isConnected
          ? STATE_COLORS.connected
          : rec.isHandshaking
          ? STATE_COLORS.handshaking
          : rec.isFailed
          ? STATE_COLORS.failed
          : STATE_COLORS.advertising;

        rec.ledMat.color.copy(stateColor);
        rec.ledMat.emissive.copy(stateColor);
        rec.ledMat.emissiveIntensity = rec.isConnected ? 1.85 : rec.isHandshaking ? 2.2 : 1.0;

        const isSelected = selectedIdRef.current === dev.device_id;
        rec.padRingMat.color.setHex(isSelected ? 0xf8fafc : stateColor.getHex());
        rec.padRingMat.emissive.copy(isSelected ? STATE_COLORS.advertising : stateColor);
        rec.padRingMat.emissiveIntensity = isSelected ? 1.6 : rec.isConnected ? 1.15 : 0.55;

        rec.linkTubeMat.color.copy(stateColor);
        rec.linkTubeMat.opacity = rec.isConnected ? 0.78 : rec.isHandshaking ? 0.45 : 0;
        rec.linkTube.visible = rec.isConnected || rec.isHandshaking;

        rec.guideMat.color.copy(stateColor);
        rec.guideMat.opacity = rec.isConnected
          ? 0.08
          : isSelected
          ? 0.65
          : rec.isHandshaking
          ? 0.7
          : 0.24;
      });
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;
    let waveTimer = 0;
    let sweepIndex = 0;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;

      const delta = Math.min(clock.getDelta(), 0.1);
      const elapsed = clock.getElapsedTime();

      syncNodes();
      boxRoot.updateMatrixWorld(true);
      emitterCap.getWorldPosition(_boxEmitterWorld);

      const allNodes = Array.from(nodesMap.values());
      const handshakingNode = allNodes.find((n) => n.isHandshaking);
      const selectedNode = selectedIdRef.current
        ? nodesMap.get(selectedIdRef.current)
        : undefined;
      const connectedNode = allNodes.find((n) => n.isConnected);

      if (handshakingNode) {
        statusHaloMat.color.copy(STATE_COLORS.handshaking);
      } else if (connectedNode) {
        statusHaloMat.color.copy(STATE_COLORS.connected);
      } else {
        statusHaloMat.color.copy(STATE_COLORS.advertising);
      }

      // Periodic Bluetooth Box dispatch waves & email packet probes
      waveTimer += delta;
      const waveInterval = handshakingNode ? 0.42 : 1.35;
      if (waveTimer >= waveInterval && allNodes.length > 0) {
        waveTimer = 0;
        const target =
          handshakingNode || selectedNode || allNodes[sweepIndex % allNodes.length];
        sweepIndex = (sweepIndex + 1) % allNodes.length;

        const waveColor = target.isHandshaking
          ? STATE_COLORS.handshaking
          : target.isConnected
          ? STATE_COLORS.connected
          : STATE_COLORS.advertising;
        spawnPairingWave(
          target.emitterWorldPos,
          waveColor,
          target.isHandshaking ? 1.35 : 0.9
        );
        if (target.isHandshaking || target.isConnected) {
          spawnEnvelopePacket(target, waveColor, true, 1.05);
        }
      }

      // Real WebSocket packet events -> Launch 3D email-style packet envelopes
      while (pulseQueueRef.current.length > 0) {
        const pkt = pulseQueueRef.current.shift()!;
        const rec = nodesMap.get(pkt.device_id);
        if (!rec) continue;

        const pulseColor =
          pkt.packet_type === 'CONN_ESTABLISHED' ||
          pkt.packet_type === 'READ' ||
          pkt.packet_type === 'NOTIFY'
            ? STATE_COLORS.connected
            : pkt.packet_type === 'CONN_REQ_SENT'
            ? STATE_COLORS.handshaking
            : pkt.packet_type === 'CONN_FAILED' || pkt.packet_type === 'CONN_TERMINATED'
            ? STATE_COLORS.failed
            : STATE_COLORS.advertising;

        const isOutgoingFromBox =
          pkt.packet_type === 'CONN_REQ_SENT' ||
          pkt.packet_type === 'CONN_ESTABLISHED' ||
          pkt.packet_type === 'WRITE';

        if (pkt.packet_type === 'CONN_REQ_SENT') {
          spawnPairingWave(rec.emitterWorldPos, STATE_COLORS.handshaking, 1.45);
        }

        rec.activityImpulse = 1.0;
        spawnEnvelopePacket(
          rec,
          pulseColor,
          isOutgoingFromBox,
          pkt.packet_type === 'CONN_REQ_SENT' ? 1.35 : 0.92
        );
      }

      // Update device placement, spawn spring-in, and device-specific animations
      for (const rec of nodesMap.values()) {
        rec.spawnScale = THREE.MathUtils.damp(rec.spawnScale, 1, 6.5, delta);
        rec.group.scale.setScalar(rec.spawnScale);
        rec.activityImpulse = THREE.MathUtils.damp(rec.activityImpulse, 0, 2.8, delta);

        rec.group.position.x = THREE.MathUtils.damp(
          rec.group.position.x,
          rec.targetPos.x,
          4.5,
          delta
        );
        rec.group.position.z = THREE.MathUtils.damp(
          rec.group.position.z,
          rec.targetPos.z,
          4.5,
          delta
        );
        rec.group.lookAt(BOX_ANCHOR.x, 0, BOX_ANCHOR.z);

        // Archetype-specific hardware motion
        if (rec.animatedPart) {
          if (rec.archetype === 'mouse') {
            rec.animatedPart.rotation.x += delta * (rec.isConnected ? 4.5 : 1.6 + rec.activityImpulse * 6);
          } else if (rec.archetype === 'laptop') {
            const lidLift = -0.22 - Math.sin(elapsed * 2.2) * 0.025 - rec.activityImpulse * 0.08;
            rec.animatedPart.rotation.x = THREE.MathUtils.damp(
              rec.animatedPart.rotation.x,
              lidLift,
              6,
              delta
            );
          } else if (rec.archetype === 'watch') {
            rec.animatedPart.position.y = Math.sin(elapsed * 3.4) * 0.025 + rec.activityImpulse * 0.04;
            rec.animatedPart.rotation.y = Math.sin(elapsed * 1.8) * 0.08;
          } else if (rec.archetype === 'mobile') {
            rec.animatedPart.rotation.z =
              Math.sin(elapsed * 22) * 0.03 * (rec.activityImpulse + (rec.isHandshaking ? 0.6 : 0));
          } else {
            rec.animatedPart.position.y = 0.36 + Math.sin(elapsed * 3) * 0.015;
          }
        }

        if (rec.isHandshaking) {
          rec.bodyGroup.position.y = 0.07 + Math.sin(elapsed * 7.5) * 0.025;
        } else {
          rec.bodyGroup.position.y = THREE.MathUtils.damp(
            rec.bodyGroup.position.y,
            0.07,
            6,
            delta
          );
        }

        rec.emitterWorldPos.set(
          rec.group.position.x,
          rec.emitterLocalY,
          rec.group.position.z
        );

        if (
          rec.lastLinkStart.distanceToSquared(_boxEmitterWorld) > 0.0004 ||
          rec.lastLinkEnd.distanceToSquared(rec.emitterWorldPos) > 0.0004
        ) {
          buildLinkCurve(_boxEmitterWorld, rec.emitterWorldPos, rec.curve);
          rec.lastLinkStart.copy(_boxEmitterWorld);
          rec.lastLinkEnd.copy(rec.emitterWorldPos);

          rec.linkTube.geometry.dispose();
          rec.linkTube.geometry = new THREE.TubeGeometry(rec.curve, 28, 0.022, 8, false);
          rec.guideLine.geometry.setFromPoints(rec.curve.getPoints(24));
        }
      }

      // Advance pairing waves
      for (let i = activeWaves.length - 1; i >= 0; i -= 1) {
        const wave = activeWaves[i];
        wave.progress += delta * wave.speed;
        if (wave.progress >= 1) {
          scene.remove(wave.mesh);
          wave.mat.dispose();
          activeWaves.splice(i, 1);
          continue;
        }
        _vA.lerpVectors(wave.start, wave.end, wave.progress);
        _vA.y += Math.sin(wave.progress * Math.PI) * 0.55;
        wave.mesh.position.copy(_vA);
        wave.mesh.scale.setScalar(0.75 + wave.progress * 1.65);
        wave.mat.opacity = Math.sin(wave.progress * Math.PI) * 0.85;
      }

      // Advance 3D Email-style Packet Envelopes along curved links
      for (let i = activePackets.length - 1; i >= 0; i -= 1) {
        const pkt = activePackets[i];
        pkt.progress += delta * pkt.speed;
        if (pkt.progress >= 1) {
          scene.remove(pkt.mesh);
          pkt.mat.dispose();
          activePackets.splice(i, 1);
          continue;
        }
        const t = pkt.reverse ? 1 - pkt.progress : pkt.progress;
        const clampedT = Math.max(0.001, Math.min(0.999, t));
        pkt.curve.getPointAt(clampedT, _vB);
        pkt.curve.getTangentAt(clampedT, _vTan);

        pkt.mesh.position.copy(_vB);
        _vA.copy(_vB).addScaledVector(_vTan, pkt.reverse ? -1 : 1);
        pkt.mesh.lookAt(_vA);
        // Gentle banking tilt as envelope glides along arc
        pkt.mesh.rotateZ(Math.sin(pkt.progress * Math.PI * 2) * 0.18 * pkt.spinSign);
        pkt.mat.opacity = 1 - Math.max(0, pkt.progress - 0.78) * 3.5;
      }

      // Camera preset transitions
      if (presetTriggerRef.current) {
        const p = presetTriggerRef.current;
        presetTriggerRef.current = null;
        if (p === 'isometric') {
          _camTarget.set(1.4, 5.6, 11.4);
          _vA.set(0.4, 0.85, 0);
        } else if (p === 'box-pov') {
          _camTarget.set(-7.6, 3.2, 3.8);
          _vA.set(1.2, 0.75, 0);
        } else {
          _camTarget.set(0.5, 13.8, 0.01);
          _vA.set(0.4, 0.4, 0);
        }
        transitionGoal = _camTarget.clone();
        _orbitFocus.copy(_vA);
      }

      if (transitionGoal) {
        camera.position.x = THREE.MathUtils.damp(camera.position.x, transitionGoal.x, 5, delta);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, transitionGoal.y, 5, delta);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, transitionGoal.z, 5, delta);
        controls.target.lerp(_orbitFocus, 1 - Math.exp(-5 * delta));
        if (camera.position.distanceTo(transitionGoal) < 0.08) {
          transitionGoal = null;
        }
      }

      controls.autoRotate = !isSoftwareGl && autoRotateRef.current;
      controls.update();

      renderer.render(scene, camera);

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    };

    tick();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 960;
      const h = container.clientHeight || 420;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      controls.dispose();
      deskTex.dispose();
      deskMat.dispose();
      boxScreenTex.dispose();
      envelopeTex.dispose();
      laptopScreenTex.dispose();
      watchDialTex.dispose();
      mobileScreenTex.dispose();
      envTex.dispose();

      matteShellMat.dispose();
      brushedMetalMat.dispose();
      darkTrimMat.dispose();
      keycapMat.dispose();
      padBaseMat.dispose();
      laptopScreenMat.dispose();
      watchDialMat.dispose();
      mobileScreenMat.dispose();
      hitGeo.dispose();
      hitMat.dispose();
      envelopeGeo.dispose();
      waveArcGeo.dispose();

      for (const rec of nodesMap.values()) {
        rec.ledMat.dispose();
        rec.padRingMat.dispose();
        rec.linkTubeMat.dispose();
        rec.linkTube.geometry.dispose();
        rec.guideMat.dispose();
        rec.guideLine.geometry.dispose();
      }
      for (const p of activePackets) p.mat.dispose();
      for (const w of activeWaves) w.mat.dispose();

      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material?.dispose();
          }
        }
      });

      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const selectedDevice = devices.find((d) => d.device_id === selectedDeviceId) || null;
  const connectedCount = devices.filter((d) => d.is_connected).length;
  const handshakingDevice = devices.find((d) => d.packet_type === 'CONN_REQ_SENT') || null;
  const selectedArchetype = selectedDevice ? classifyDeviceArchetype(selectedDevice) : null;

  return (
    <section className="relative overflow-hidden rounded-lg border border-zinc-800 bg-[#080a10]">
      {/* Dedicated WebGL Mount Container */}
      <div
        ref={mountRef}
        className="h-[390px] w-full sm:h-[440px]"
        aria-label="Interactive 3D Bluetooth Packet Box to Auto-Detected Devices Scene"
      />

      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/95 text-sm text-zinc-300">
          3D WebGL context temporarily suspended. Restoring viewport...
        </div>
      )}

      {/* Minimal Top-Left Spatial Telemetry Readout */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-1">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-zinc-100">
          <Box className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
          <span>Bluetooth Packet Box &rarr; Auto-Detected Devices</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums text-zinc-400">
          <span>{devices.length} Detected Devices</span>
          <span aria-hidden="true">·</span>
          <span className="text-emerald-400">{connectedCount} Paired Links</span>
          {handshakingDevice && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-400">
                Dispatching Packet to {handshakingDevice.device_name}...
              </span>
            </>
          )}
        </div>
      </div>

      {/* Collapsible Bottom Control Dock (Zero Viewport Occlusion) */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex w-max max-w-[94vw] -translate-x-1/2 flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="pointer-events-auto mb-1.5 inline-flex items-center gap-1 rounded-t-md border border-b-0 border-zinc-700/80 px-3 py-1 text-[11px] font-medium text-zinc-300 hover:text-white"
          style={{ backgroundColor: 'rgba(9, 9, 11, 0.92)' }}
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
              Show 3D Controls
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
              Hide Controls
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div
            className="pointer-events-auto flex flex-col gap-2 rounded-lg border border-zinc-700/80 px-3 py-2 text-xs"
            style={{ backgroundColor: 'rgba(9, 9, 11, 0.92)' }}
          >
            {selectedDevice && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="truncate font-semibold text-zinc-100">
                    {selectedDevice.device_name}
                  </span>
                  {selectedArchetype && (
                    <span className="font-mono text-[11px] text-sky-400">
                      [{ARCHETYPE_LABELS[selectedArchetype]}]
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-zinc-400">
                    {selectedDevice.mac_address}
                  </span>
                  <RssiText rssi={selectedDevice.rssi} />
                  <span className="font-mono text-[11px] text-zinc-300">
                    {selectedDevice.device_health?.link_stability || 'Standby'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onQuickConnectToggle(selectedDevice)}
                    className={`rounded px-2.5 py-1 text-[11px] font-semibold text-white transition-colors ${
                      selectedDevice.is_connected
                        ? 'bg-red-600 hover:bg-red-500'
                        : 'bg-blue-600 hover:bg-blue-500'
                    }`}
                  >
                    {selectedDevice.is_connected ? 'Disconnect Link' : 'Send Connect Packet'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectDevice(null)}
                    className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="flex items-center gap-1 border-r border-zinc-800 pr-2">
                <Compass className="mr-1 h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                {(['isometric', 'box-pov', 'top'] as CameraPreset[]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyCameraPreset(preset)}
                    className={`whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      cameraPreset === preset
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {preset === 'box-pov'
                      ? 'Box POV'
                      : preset === 'top'
                      ? 'Top View'
                      : 'Stage View'}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setAutoRotate((v) => !v)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  autoRotate ? 'bg-blue-600/25 text-sky-300' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <RotateCw className="h-3 w-3" aria-hidden="true" />
                Orbit {autoRotate ? 'On' : 'Paused'}
              </button>

              <div className="hidden md:flex items-center gap-3 border-l border-zinc-800 pl-2 text-[11px] text-zinc-400">
                <span className="inline-flex items-center gap-1">
                  <Wifi className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                  Paired
                </span>
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3 w-3 text-amber-400" aria-hidden="true" />
                  Packet Envelope
                </span>
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3 w-3 text-sky-400" aria-hidden="true" />
                  Advertising
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
