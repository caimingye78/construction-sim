import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';

// ─── Scene Setup ───────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 80, 150);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(25, 18, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 7, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.2;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.update();

// ─── Lights ────────────────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0x404060, 0.4);
scene.add(ambientLight);
const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x3a7d44, 0.6);
scene.add(hemisphereLight);

const sunLight = new THREE.DirectionalLight(0xfff4e6, 1.8);
sunLight.position.set(30, 35, 20);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 80;
sunLight.shadow.camera.left = -30;
sunLight.shadow.camera.right = 30;
sunLight.shadow.camera.top = 30;
sunLight.shadow.camera.bottom = -30;
scene.add(sunLight);
scene.add(sunLight.target);

const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
fillLight.position.set(-20, 10, -20);
scene.add(fillLight);

// ─── Ground ────────────────────────────────────────────────────────────────
const groundGeo = new THREE.PlaneGeometry(60, 60);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x5a8f5a, roughness: 0.9, metalness: 0
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Grid helper
const grid = new THREE.GridHelper(60, 30, 0x88bb88, 0x447744);
grid.position.y = 0.05;
scene.add(grid);

// Foundation
const foundationMat = new THREE.MeshStandardMaterial({ color: 0x666677, roughness: 0.8, metalness: 0.2 });
const foundation = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 10), foundationMat);
foundation.position.set(0, 0.2, 0);
foundation.receiveShadow = true;
foundation.castShadow = true;
scene.add(foundation);

// Site boundary markers
const markerMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff6600, emissiveIntensity: 0.2 });
for (let i = 0; i < 4; i++) {
  const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.2), markerMat);
  m.position.set(Math.cos(angle) * 5.5, 0.25, Math.sin(angle) * 5.5);
  scene.add(m);
}

// ─── UI Controller ────────────────────────────────────────────────────────
const UI = {
  phaseEl: document.getElementById('phase-text'),
  compCountEl: document.getElementById('comp-count'),
  validCountEl: document.getElementById('valid-count'),
  floorNumEl: document.getElementById('floor-num'),
  statusMsg: document.getElementById('status-msg'),
  progressDots: document.getElementById('progress-dots'),
  dots: [],
  statusTimeout: null,
  setPhase(text) { this.phaseEl.textContent = text; },
  setFloor(n) { this.floorNumEl.textContent = n; },
  setComponents(n) { this.compCountEl.textContent = n; },
  setValidated(n) { this.validCountEl.textContent = n; },
  setStatus(text) {
    this.statusMsg.textContent = text;
    this.statusMsg.style.opacity = 1;
    clearTimeout(this.statusTimeout);
    this.statusTimeout = setTimeout(() => { this.statusMsg.style.opacity = 0.4; }, 3000);
  },
  initDots(n) {
    this.progressDots.innerHTML = '';
    this.dots = [];
    for (let i = 0; i < n; i++) {
      const d = document.createElement('div');
      d.className = 'progress-dot';
      this.progressDots.appendChild(d);
      this.dots.push(d);
    }
  },
  setDotActive(i) {
    this.dots.forEach((d, j) => {
      d.className = 'progress-dot' + (j === i ? ' active' : '') + (j < i ? ' done' : '');
    });
  }
};

// ─── Building Config ────────────────────────────────────────────────────────
const FLOORS = 5;
const FLOOR_H = 3;
const BUILDING_W = 8;
const BUILDING_D = 8;
const COL_W = 0.3;
const BEAM_H = 0.25;
const SLAB_H = 0.15;

// Component positions
function getFloorY(floor) { return 0.4 + floor * FLOOR_H; }
function getColumnPositions(floor) {
  const y = getFloorY(floor) + FLOOR_H / 2;
  const hw = BUILDING_W / 2 - COL_W / 2;
  const hd = BUILDING_D / 2 - COL_W / 2;
  return [
    [-hw, y, -hd], [hw, y, -hd], [-hw, y, hd], [hw, y, hd]
  ];
}
function getBeamPositions(floor) {
  const y = getFloorY(floor) + FLOOR_H - BEAM_H / 2;
  const hw = BUILDING_W / 2;
  const hd = BUILDING_D / 2;
  return [
    { pos: [0, y, -hd], size: [BUILDING_W, BEAM_H, 0.2] },  // front
    { pos: [0, y, hd],  size: [BUILDING_W, BEAM_H, 0.2] },  // back
    { pos: [-hw, y, 0], size: [0.2, BEAM_H, BUILDING_D] },  // left
    { pos: [hw, y, 0],  size: [0.2, BEAM_H, BUILDING_D] },  // right
  ];
}
function getSlabPosition(floor) {
  return [0, getFloorY(floor) + FLOOR_H - SLAB_H / 2, 0];
}

// ─── Materials ─────────────────────────────────────────────────────────────
const matSteel = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.4, metalness: 0.7 });
const matColumn = new THREE.MeshStandardMaterial({ color: 0x7788aa, roughness: 0.3, metalness: 0.8 });
const matBeam = new THREE.MeshStandardMaterial({ color: 0x667788, roughness: 0.4, metalness: 0.7 });
const matSlab = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6, metalness: 0.2 });
const matWall = new THREE.MeshStandardMaterial({ color: 0x88aacc, roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.6 });
const matGhost = new THREE.MeshStandardMaterial({ color: 0x64ffda, transparent: true, opacity: 0.15, depthWrite: false });
const matValid = new THREE.MeshStandardMaterial({ color: 0x00c853, emissive: 0x00c853, emissiveIntensity: 0.3 });
const matCrane = new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.5, metalness: 0.3 });
const matCraneArm = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.4, metalness: 0.4 });

// ─── Building Components ──────────────────────────────────────────────────
const components = [];
const placedComponents = [];
let compCount = 0;
let validCount = 0;

function createComponent(type, pos, size, color) {
  const geo = new THREE.BoxGeometry(...size);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.6 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function createGhost(targetPos, size) {
  const geo = new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geo, matGhost);
  mesh.position.set(...targetPos);
  scene.add(mesh);
  return mesh;
}

// ─── Crane System ──────────────────────────────────────────────────────────
class Crane {
  constructor() {
    this.group = new THREE.Group();
    this.group.position.set(11, 0, -8);
    scene.add(this.group);

    // Tower
    const towerMat = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.5, metalness: 0.3 });
    for (let i = 0; i < 8; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.5, 0.6), towerMat);
      seg.position.y = 1.25 + i * 2.5;
      seg.castShadow = true;
      this.group.add(seg);
      // Cross braces
      if (i < 7) {
        const bMat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
        for (let side = 0; side < 4; side++) {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4), bMat);
          b.position.y = 2.5 + i * 2.5;
          b.rotation.z = side % 2 === 0 ? 0.5 : -0.5;
          b.rotation.y = (side / 4) * Math.PI * 2;
          this.group.add(b);
        }
      }
    }
    this.towerHeight = 20;

    // Slewing platform
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 0.3, 12), towerMat);
    plat.position.y = this.towerHeight;
    plat.castShadow = true;
    this.group.add(plat);

    // Jib
    this.jibGroup = new THREE.Group();
    this.jibGroup.position.y = this.towerHeight + 0.15;
    this.group.add(this.jibGroup);

    this.jibLength = 14;
    const jibMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.5, metalness: 0.3 });
    const jib = new THREE.Mesh(new THREE.BoxGeometry(this.jibLength, 0.2, 0.25), jibMat);
    jib.position.x = this.jibLength / 2 - 1;
    jib.castShadow = true;
    this.jibGroup.add(jib);

    // Jib cross braces
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4), jibMat);
      b.position.set(1 + i * 2, 0.2, 0);
      b.rotation.x = 0.3;
      this.jibGroup.add(b);
    }

    // Counter jib
    const cjib = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 0.25), jibMat);
    cjib.position.x = -1.5;
    cjib.castShadow = true;
    this.jibGroup.add(cjib);

    // Counter weight
    const cw = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.8), new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 }));
    cw.position.set(-2, -0.4, 0);
    this.jibGroup.add(cw);

    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.5 }));
    cabin.position.set(0, 0.2, 0);
    this.jibGroup.add(cabin);

    // Trolley
    this.trolleyGroup = new THREE.Group();
    this.trolleyGroup.position.set(4, 0, 0);
    this.jibGroup.add(this.trolleyGroup);

    const trolley = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.5), new THREE.MeshStandardMaterial({ color: 0xdd4444, roughness: 0.4 }));
    trolley.castShadow = true;
    this.trolleyGroup.add(trolley);

    // Cable
    this.cableLength = 0;
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.3 }));
    this.cable.position.y = -0.5;
    this.trolleyGroup.add(this.cable);

    // Hook
    const hookGroup = new THREE.Group();
    hookGroup.position.y = 0;
    this.trolleyGroup.add(hookGroup);
    this.hookGroup = hookGroup;

    const hookMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.9, roughness: 0.2 });
    const hookBody = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.15), hookMat);
    hookBody.castShadow = true;
    hookGroup.add(hookBody);
    const hookCurve = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 4, 8, Math.PI), hookMat);
    hookCurve.position.y = -0.2;
    hookCurve.rotation.x = Math.PI / 2;
    hookGroup.add(hookCurve);

    // State
    this.targetTrolleyX = 4;
    this.targetSwingAngle = 0;
    this.targetCableLen = 0;
    this.attachedComponent = null;
    this.attachOffset = new THREE.Vector3();
    this.speed = 1.2;
  }

  moveTrolley(x) {
    this.targetTrolleyX = Math.max(0.5, Math.min(this.jibLength - 1, x));
  }
  swing(angle) {
    this.targetSwingAngle = angle;
  }
  setCable(len) {
    this.targetCableLen = Math.max(0.5, Math.min(25, len));
  }
  attach(component) {
    this.attachedComponent = component;
    if (component) {
      this.attachOffset.copy(component.position).sub(this.getHookWorldPosition());
    }
  }
  detach() {
    const c = this.attachedComponent;
    this.attachedComponent = null;
    return c;
  }
  getHookWorldPosition() {
    const v = new THREE.Vector3(0, -this.cableLength, 0);
    this.trolleyGroup.localToWorld(v);
    return v;
  }
  update(dt) {
    // Smooth swing
    const curAngle = this.group.rotation.y;
    this.group.rotation.y += (this.targetSwingAngle - curAngle) * Math.min(1, dt * 1.5);

    // Smooth trolley
    const curTx = this.trolleyGroup.position.x;
    this.trolleyGroup.position.x += (this.targetTrolleyX - curTx) * Math.min(1, dt * 2);

    // Smooth cable
    this.cableLength += (this.targetCableLen - this.cableLength) * Math.min(1, dt * 3);
    this.cableLength = Math.max(0.5, this.cableLength);
    this.cable.scale.y = this.cableLength;
    this.cable.position.y = -this.cableLength / 2;

    // Hook follows cable
    this.hookGroup.position.y = -this.cableLength;

    // Attached component follows hook
    if (this.attachedComponent) {
      const hookPos = this.getHookWorldPosition();
      this.attachedComponent.position.copy(hookPos);
      this.attachedComponent.position.y -= 0.5;
    }
  }
}

// ─── Truck System ──────────────────────────────────────────────────────────
const trucks = [];
function createTruck(x, z, rotation) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  scene.add(group);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x334466, roughness: 0.5, metalness: 0.3 });
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x445577, roughness: 0.5, metalness: 0.3 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });

  // Cab
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1), cabMat);
  cab.position.set(1.5, 0.5, 0);
  cab.castShadow = true;
  group.add(cab);

  // Windshield
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.5, metalness: 0.9, roughness: 0.1 });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.7), glassMat);
  glass.position.set(2.1, 0.55, 0);
  group.add(glass);

  // Bed
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 1.2), bodyMat);
  bed.position.set(-0.5, 0.35, 0);
  bed.castShadow = true;
  group.add(bed);

  // Bed sides
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x2a3a5a, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 0.05), sideMat);
    s.position.set(-0.5, 0.65, side * 0.6);
    group.add(s);
  }

  // Wheels
  for (const [wx, wz] of [[1.5, 0.6], [1.5, -0.6], [-0.5, 0.6], [-0.5, -0.6], [-1.5, 0.6], [-1.5, -0.6]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 8), wheelMat);
    w.position.set(wx, 0.15, wz);
    w.rotation.x = Math.PI / 2;
    group.add(w);
  }

  // Headlights
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 0.5 });
  for (const side of [-0.3, 0.3]) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.08, 8), lightMat);
    l.position.set(2.1, 0.35, side);
    l.rotation.y = Math.PI / 2;
    group.add(l);
  }

  return { group, bed, targetX: x, arrived: true, departureTimer: 0 };
}

// Create two delivery trucks
const truck1 = createTruck(-18, 0, 0);
const truck2 = createTruck(18, 8, Math.PI);
trucks.push(truck1, truck2);

// ─── Assembly Robots ───────────────────────────────────────────────────────
const robots = [];
function createRobot(x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  scene.add(group);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdd4444, roughness: 0.3, metalness: 0.5 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3), bodyMat);
  body.position.y = 0.3;
  body.castShadow = true;
  group.add(body);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), accentMat);
  head.position.y = 0.55;
  group.add(head);

  // Eye (sensor light)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 1 }));
  eye.position.set(0, 0.55, 0.12);
  group.add(eye);

  // Arms
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), darkMat);
    arm.position.set(side * 0.25, 0.35, 0);
    group.add(arm);
    // Tool
    const tool = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.1), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.2 }));
    tool.position.set(side * 0.25, 0.25, 0);
    group.add(tool);
  }

  // Base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.05, 8), darkMat);
  base.position.y = 0.025;
  group.add(base);

  // Glow ring
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.3, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  glow.position.y = 0.05;
  glow.rotation.x = -Math.PI / 2;
  group.add(glow);

  return {
    group,
    targetPos: new THREE.Vector3(x, y, z),
    state: 'idle', // idle, moving, working, done
    workTimer: 0,
    eye,
    glow,
    update(dt) {
      // Smooth movement
      this.group.position.lerp(this.targetPos, Math.min(1, dt * 2));
      // Bob
      this.group.position.y += Math.sin(Date.now() * 0.005) * 0.01;
      // Eye flash
      this.eye.material.emissiveIntensity = 0.5 + Math.sin(Date.now() * 0.008) * 0.5;
    }
  };
}

// Create 4 assembly robots
for (let i = 0; i < 4; i++) {
  const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
  const r = 6;
  const robot = createRobot(Math.cos(angle) * r, 0.4, Math.sin(angle) * r);
  robots.push(robot);
}

// ─── Construction Manager ──────────────────────────────────────────────────
class ConstructionManager {
  constructor() {
    this.phase = 0;
    this.subPhase = 0;
    this.componentIndex = 0;
    this.currentFloor = 0;
    this.timer = 0;
    this.isRunning = true;
    this.crane = new Crane();
    this.sequence = [];
    this.ghosts = [];
    this.buildSequence();
    UI.initDots(FLOORS * 4 + 1);
    UI.setPhase("Preparing site...");
  }

  buildSequence() {
    // Each floor: columns (4) → beams (4) → slab (1) → walls (2-4) → validate
    for (let f = 0; f < FLOORS; f++) {
      const fy = getFloorY(f);
      // Columns
      const colPositions = getColumnPositions(f);
      colPositions.forEach(p => {
        this.sequence.push({ type: 'column', pos: p, size: [COL_W, FLOOR_H, COL_W], floor: f, color: 0x7788aa });
      });
      // Beams
      const beamPositions = getBeamPositions(f);
      beamPositions.forEach(b => {
        this.sequence.push({ type: 'beam', pos: b.pos, size: b.size, floor: f, color: 0x667788 });
      });
      // Slab
      this.sequence.push({ type: 'slab', pos: getSlabPosition(f), size: [BUILDING_W - 0.4, SLAB_H, BUILDING_D - 0.4], floor: f, color: 0x999999 });
      // Walls
      const wy = getFloorY(f) + FLOOR_H / 2;
      const ww = BUILDING_W * 0.85;
      const wd = BUILDING_D * 0.85;
      this.sequence.push({ type: 'wall', pos: [0, wy, -wd/2], size: [ww, FLOOR_H * 0.8, 0.1], floor: f, color: 0x88aacc });
      this.sequence.push({ type: 'wall', pos: [0, wy, wd/2], size: [ww, FLOOR_H * 0.8, 0.1], floor: f, color: 0x88aacc });
      this.sequence.push({ type: 'wall', pos: [-ww/2, wy, 0], size: [0.1, FLOOR_H * 0.8, wd], floor: f, color: 0x88aacc });
      this.sequence.push({ type: 'wall', pos: [ww/2, wy, 0], size: [0.1, FLOOR_H * 0.8, wd], floor: f, color: 0x88aacc });
      // Validation
      this.sequence.push({ type: 'validate', floor: f });
    }
    // Roof
    this.sequence.push({ type: 'roof', pos: [0, getFloorY(FLOORS), 0], size: [BUILDING_W + 0.5, 0.2, BUILDING_D + 0.5], floor: FLOORS, color: 0x888899 });
    this.sequence.push({ type: 'complete' });
  }

  spawnDeliveryTruck(comp) {
    // Pick a truck
    const truck = truck1;
    const startX = -18;
    const targetX = -6;

    // Move truck to site
    truck.group.position.x = THREE.MathUtils.lerp(truck.group.position.x, targetX, 0.02);

    // Check if truck arrived
    if (Math.abs(truck.group.position.x - targetX) < 0.5) {
      return true;
    }
    return false;
  }

  startComponent(comp) {
    const isFirst = compCount === 0;
    // Create ghost at target position
    if (comp.type !== 'validate' && comp.type !== 'complete') {
      const ghost = createGhost(comp.pos, comp.size);
      this.ghosts.push(ghost);
    }

    // Create the actual component off-site (on truck bed)
    if (comp.type !== 'validate' && comp.type !== 'complete') {
      const mesh = createComponent(comp.type, [12, 1.5, -8], comp.size, comp.color);
      scene.add(mesh);
      compCount++;
      UI.setComponents(compCount);
      placedComponents.push(mesh);

      // Animate: crane picks it up from truck position
      const startPos = new THREE.Vector3(12, 1.5, -8);
      const targetPos = new THREE.Vector3(...comp.pos);

      // Move component from truck to crane
      const midPos = new THREE.Vector3(6, 12, -4);
      mesh.position.copy(startPos);
      mesh.userData.animating = true;
      mesh.userData.animProgress = 0;
      mesh.userData.startPos = startPos;
      mesh.userData.midPos = midPos;
      mesh.userData.targetPos = targetPos;
      mesh.userData.phase = 'pickup'; // pickup → lift → swing → place → settle
      mesh.userData.rotSpeed = 0.5 + Math.random() * 0.5;
    }
  }

  updateAnimation(mesh, dt) {
    if (!mesh.userData.animating) return;
    mesh.userData.animProgress += dt * 0.3;

    const p = Math.min(mesh.userData.animProgress, 1);
    let t = p;

    // Ease in-out cubic
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Slight rotation during animation
    mesh.rotation.y += dt * mesh.userData.rotSpeed;

    if (mesh.userData.phase === 'pickup') {
      // First 30%: lift from truck
      if (p < 0.3) {
        const tp = p / 0.3;
        mesh.position.lerpVectors(mesh.userData.startPos, mesh.userData.midPos, tp);
      } else {
        mesh.userData.phase = 'swing';
      }
    } else if (mesh.userData.phase === 'swing') {
      // 30-70%: swing to building
      const tp = (p - 0.3) / 0.4;
      const swingPos = new THREE.Vector3().lerpVectors(mesh.userData.midPos, mesh.userData.targetPos, tp);
      swingPos.y = 12 - tp * 5; // descend gradually
      mesh.position.copy(swingPos);
      if (p > 0.7) {
        mesh.userData.phase = 'place';
      }
    } else if (mesh.userData.phase === 'place') {
      // 70-100%: lower into position
      const tp = (p - 0.7) / 0.3;
      const start = new THREE.Vector3(mesh.userData.targetPos.x, mesh.userData.midPos.y - 5, mesh.userData.targetPos.z);
      const end = new THREE.Vector3(...mesh.userData.targetPos);
      // Descend with slight overshoot
      const descend = tp < 0.8 ? tp / 0.8 : 1 - (tp - 0.8) * 0.5;
      mesh.position.lerpVectors(start, end, descend);
      // Straighten
      mesh.rotation.y *= 0.95;
      if (p >= 1) {
        mesh.userData.animating = false;
        mesh.position.set(...mesh.userData.targetPos);
        mesh.rotation.set(0, 0, 0);
        // Validate
        this.validateComponent(mesh);
      }
    }
  }

  validateComponent(mesh) {
    // Simple structural validation
    mesh.material = matValid;
    validCount++;
    UI.setValidated(validCount);
    // Flash effect
    const flash = new THREE.Mesh(
      new THREE.BoxGeometry(
        mesh.geometry.parameters.width * 1.1,
        mesh.geometry.parameters.height * 1.1,
        mesh.geometry.parameters.depth * 1.1
      ),
      new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.3,
        wireframe: true
      })
    );
    flash.position.copy(mesh.position);
    scene.add(flash);
    setTimeout(() => {
      scene.remove(flash);
    }, 1000);
    UI.setStatus(`✅ Component validated: ${mesh.userData.type || 'structural'}`);
  }

  update(dt) {
    this.crane.update(dt);
    this.timer += dt;

    // Update robot animations
    robots.forEach(r => r.update(dt));

    // Update component animations
    placedComponents.forEach(mesh => {
      if (mesh.userData.animating) {
        this.updateAnimation(mesh, dt);
      }
    });

    // Update ghosts
    this.ghosts.forEach((g, i) => {
      g.material.opacity = 0.1 + Math.sin(Date.now() * 0.002 + i) * 0.05;
    });

    // Advance construction sequence
    if (this.isRunning && this.phase < this.sequence.length) {
      const comp = this.sequence[this.phase];
      this.componentTimer = (this.componentTimer || 0) + dt;

      if (comp.type === 'validate') {
        UI.setPhase(`📐 Validating floor ${comp.floor + 1}...`);
        if (this.componentTimer > 1.5) {
          this.componentTimer = 0;
          this.phase++;
          UI.setDotActive(comp.floor);
          UI.setFloor(Math.min(comp.floor + 1, FLOORS));
          UI.setStatus(`✅ Floor ${comp.floor + 1} complete!`);
        }
      } else if (comp.type === 'complete') {
        UI.setPhase("🏗️ Construction Complete!");
        UI.setStatus("🎉 All 5 floors erected successfully!");
        this.isRunning = false;
      } else {
        const floorInfo = comp.floor !== undefined ? `F${comp.floor + 1}` : '';
        const typeNames = { column: 'Column', beam: 'Beam', slab: 'Floor Slab', wall: 'Wall Panel', roof: 'Roof' };
        UI.setPhase(`🚧 Placing ${typeNames[comp.type] || comp.type} ${floorInfo}`);

        if (this.componentTimer > 0.2) {
          this.componentTimer = 0;
          this.startComponent(comp);
          this.phase++;

          // Update status message
          const deliveryMsgs = [
            "🚛 Truck delivering component...",
            "🏗️ Crane lifting into position...",
            "🔩 Robot fastening connections...",
            "📐 Checking alignment..."
          ];
          UI.setStatus(deliveryMsgs[Math.floor(Math.random() * deliveryMsgs.length)]);
        }
      }
    }

    // Crane sweep animation
    this.crane.swing(Math.sin(Date.now() * 0.0003) * 0.3);
    this.crane.moveTrolley(4 + Math.sin(Date.now() * 0.0005) * 2);
    this.crane.setCable(8 + Math.sin(Date.now() * 0.0004) * 3);
  }
}

// ─── Environment ───────────────────────────────────────────────────────────
// Trees
function createTree(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  scene.add(group);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2a7a2a, roughness: 0.8 });

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.5, 6), trunkMat);
  trunk.position.y = 0.75;
  trunk.castShadow = true;
  group.add(trunk);

  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 6), leafMat);
  crown.position.y = 1.8;
  crown.castShadow = true;
  group.add(crown);
  return group;
}
// Scatter trees
for (let i = 0; i < 16; i++) {
  let x, z;
  do {
    x = (Math.random() - 0.5) * 50;
    z = (Math.random() - 0.5) * 50;
  } while (Math.abs(x) < 12 && Math.abs(z) < 12); // Keep away from building
  createTree(x, z);
}

// Road
function createRoad() {
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.9, metalness: 0.1 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(4, 30), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(-14, 0.1, 0);
  road.receiveShadow = true;
  scene.add(road);
  // Road markings
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffff66, emissive: 0xffff66, emissiveIntensity: 0.1 });
  for (let i = 0; i < 10; i++) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(-14, 0.12, -12 + i * 3);
    scene.add(line);
  }
}
createRoad();

// Site fence
function createFence() {
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.7 });
  for (let side = 0; side < 4; side++) {
    const angle = (side / 4) * Math.PI * 2 + Math.PI / 4;
    const len = 7;
    for (let i = 0; i < 5; i++) {
      const t = -len / 2 + (i / 4) * len;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.8, 6), fenceMat);
      post.position.set(Math.cos(angle) * (5.8 + t * 0.01), 0.4, Math.sin(angle) * (5.8 + t * 0.01));
      scene.add(post);
    }
    // Rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.03), fenceMat);
    rail.position.set(
      Math.cos(angle) * 5.8,
      0.5,
      Math.sin(angle) * 5.8
    );
    rail.lookAt(0, 0.5, 0);
    scene.add(rail);
  }
}
createFence();

// Safety signs
function createSign(x, z, text) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  scene.add(group);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4), new THREE.MeshStandardMaterial({ color: 0x888888 }));
  pole.position.y = 0.4;
  group.add(pole);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.02), new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 0.1 }));
  board.position.y = 0.8;
  group.add(board);
  return group;
}
createSign(6, 6, "DANGER");
createSign(-6, -6, "HARD HAT");

// Material storage area
function createStorage() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x556677, roughness: 0.7 });
  for (let i = 0; i < 5; i++) {
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1 + i * 0.08, 0.6), mat);
    stack.position.set(10, 0.05 + i * 0.08, 6);
    stack.castShadow = true;
    scene.add(stack);
  }
}
createStorage();

// ─── Initialize Simulation ─────────────────────────────────────────────────
let construction;
let physicsWorld;

async function init() {
  await RAPIER.init();
  physicsWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  construction = new ConstructionManager();

  animate();
}

// ─── Animation Loop ────────────────────────────────────────────────────────
let lastTime = 0;

function animate(time = 0) {
  requestAnimationFrame(animate);
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;

  if (construction) {
    construction.update(dt);
    if (physicsWorld) {
      physicsWorld.step();
    }
  }

  // Camera auto-orbit slight
  controls.update();
  renderer.render(scene, camera);
}

// ─── Resize ────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Start ─────────────────────────────────────────────────────────────────
init().catch(console.error);
