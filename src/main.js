import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { Hud } from './hud.js';
import { Simulation } from './sim.js';

const canvas = document.getElementById('gl');
const hud = new Hud();

// ---- renderer: WebGPU primary, WebGL fallback ---------------------------------
let renderer = null;
let backend = 'WebGPU';
try {
  renderer = new WebGPURenderer({ canvas, antialias: true });
} catch (e) {
  backend = 'WebGL';
  renderer = new WebGLRenderer({ canvas, antialias: true });
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
if ('shadowMap' in renderer) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
await renderer.init?.();

// ---- scene --------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb2c8);
scene.fog = new THREE.Fog(0x8fb2c8, 60, 160);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(36, 26, 36);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 9, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2.05;
controls.minDistance = 6;
controls.maxDistance = 120;

// sun + sky
const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
sun.position.set(38, 46, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -32; sun.shadow.camera.right = 32;
sun.shadow.camera.top = 32; sun.shadow.camera.bottom = -32;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xcfe4f2, 0x5a5448, 1.1));
scene.add(new THREE.AmbientLight(0xffffff, 0.25));

// site dressing: grid, road, boundary
const grid = new THREE.GridHelper(100, 40, 0x4e5a4a, 0x4e5a4a);
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.position.y = 0.01;
scene.add(grid);

const road = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 7),
  new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 1 }),
);
road.rotation.x = -Math.PI / 2;
road.position.set(-15, 0.02, -10.5);
scene.add(road);
const roadLine = new THREE.Mesh(
  new THREE.PlaneGeometry(110, 0.18),
  new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 1 }),
);
roadLine.rotation.x = -Math.PI / 2;
roadLine.position.set(-15, 0.03, -10.5);
scene.add(roadLine);

// site boundary posts
const postMat = new THREE.MeshStandardMaterial({ color: 0xd98e2b, roughness: 0.6 });
for (const [px, pz] of [[-14, -14], [14, -14], [14, 14], [-14, 14], [0, 0]]) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 8), postMat);
  post.position.set(px * 1.1 + (px === 0 ? 0 : 0), 0.55, pz * 1.1 + (pz === 0 ? 0 : 0));
  scene.add(post);
}
// building footprint marker
const fp = new THREE.Mesh(
  new THREE.PlaneGeometry(8.4, 8.4),
  new THREE.MeshBasicMaterial({ color: 0xffb03a, transparent: true, opacity: 0.14, depthWrite: false }),
);
fp.rotation.x = -Math.PI / 2;
fp.position.y = 0.02;
scene.add(fp);

// ---- simulation ---------------------------------------------------------------
const sim = new Simulation(scene, hud);
await RAPIER.init();
await sim.init();
sim.start();

// ---- camera views -------------------------------------------------------------
const VIEWS = {
  overview: { pos: [36, 26, 36], tgt: [0, 9, 0] },
  crane: { pos: [-20, 30, -24], tgt: [-5, 16, -6] },
  truck: { pos: [-30, 7, -22], tgt: [-14, 2, -10] },
  robot: { pos: [8, 18, 22], tgt: [0, 9, 0] },
};
document.querySelectorAll('#view-btns button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#view-btns button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    const v = VIEWS[btn.dataset.view];
    camera.position.set(...v.pos);
    controls.target.set(...v.tgt);
  });
});
document.getElementById('report-reload').addEventListener('click', () => location.reload());
hud.log(`Renderer: ${backend}${backend === 'WebGPU' ? '' : ' (fallback)'} · Three r${THREE.REVISION}`, 'info');

// ---- loop ---------------------------------------------------------------------
sim.speed = new URLSearchParams(location.search).has('fast') ? 4 : 1;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 10);
  sim.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__SIM__ = sim; // console debugging handle
