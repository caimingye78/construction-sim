import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { TowerCrane } from './crane.js';
import { Truck, RobotFleet } from './actors.js';
import { designJobs, COMP_COLOR, validatePlacement, finalReport } from './building.js';

const KIN = 2, DYN = 0, FIX = 1;   // Rapier RigidBodyType
const CRUISE = 22.5;               // hook cruise height above ground
const GAP = 0.06;                  // release gap above support

export class Simulation {
  constructor(scene, hud) {
    this.scene = scene;
    this.hud = hud;
    this.components = [];        // all built components {job, mesh, body, center, quat, halfH, status, devPos}
    this.placed = [];
    this.retries = 0;
    this.trucks = [];
    this.phase = 'START';
    this._stepCount = 0;
  }

  async init() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;

    // ground + site dressing
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(70, 0.1, 70).setTranslation(0, -0.1, 0), ground);
    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 140),
      new THREE.MeshStandardMaterial({ color: 0x5f6b52, roughness: 1 }),
    );
    groundMesh.rotation.x = -Math.PI / 2; groundMesh.position.y = 0; groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    this.crane = new TowerCrane(this.scene, {});
    this.robots = new RobotFleet(this.scene, 2);

    // staging pads for pre-staged components
    this.staging = [];
    this.jobs = designJobs();
    this._placedStaged();
    this.truckPending = [];       // jobs waiting for a truck that hasn't arrived
    this.truckSpawned = 0;
    this.queue = [...this.jobs];
    this._ensureTruck();
    this.current = null;
    this.state = null;
    this.t0 = Date.now();
    this.hud.setPhase(0, this.jobs.length);
    this.hud.log('Site commissioned — erecting 5-storey Tower B', 'info');
    this.hud.log('Crane online · fleet: 2 fastening robots', 'info');
  }

  // ---- component creation -------------------------------------------------------

  _makeComponent(job) {
    const [w, h, d] = job.dims;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color: COMP_COLOR[job.kind],
        roughness: job.kind === 'facade' ? 0.15 : 0.65,
        metalness: job.kind === 'facade' ? 0.1 : 0.35,
        transparent: job.kind === 'facade',
        opacity: job.kind === 'facade' ? 0.55 : 1,
      }),
    );
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  _bodyFor(job, type, pos) {
    const [w, h, d] = job.dims;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc[type === FIX ? 'fixed' : type === KIN ? 'kinematicPositionBased' : 'dynamic']()
        .setTranslation(pos.x, pos.y, pos.z)
        .setCanSleep(false),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setFriction(0.9), body,
    );
    return body;
  }

  _register(job, body, mesh) {
    const comp = {
      job, body, mesh,
      halfH: job.dims[1] / 2,
      center: new THREE.Vector3().copy(body.translation()),
      quat: { x: 0, y: 0, z: 0, w: 1 },
      status: null, devPos: 0, floor: job.floor,
    };
    this.components.push(comp);
    return comp;
  }

  /** Pre-park staged components on pads beside the crane. */
  _placedStaged() {
    const staged = this.jobs.filter(j => j.delivery === 'staged');
    let i = 0;
    for (const job of staged) {
      const mesh = this._makeComponent(job);
      const padX = 6.5 + (i % 3) * 2.4, padZ = 5.5 + Math.floor(i / 3) * 2.4;
      job.stagePos = { x: padX, z: padZ };   // reuse for RESEAT re-fabrication
      const body = this._bodyFor(job, FIX, { x: padX, y: job.dims[1] / 2, z: padZ });
      this._register(job, body, mesh);
      // pads
      const pad = new THREE.Mesh(new THREE.BoxGeometry(job.dims[0] + 0.3, 0.16, job.dims[2] + 0.3),
        new THREE.MeshStandardMaterial({ color: 0x4a443a, roughness: 1 }));
      pad.position.set(padX, 0.08, padZ);
      this.scene.add(pad);
      this.staging.push(pad);
      i++;
    }
  }

  /** Remove a rejected component from the world entirely (body + mesh). */
  _disposeComp(comp) {
    this.world.removeRigidBody(comp.body);
    this.scene.remove(comp.mesh);
    comp.mesh.geometry.dispose();
    comp.mesh.material.dispose();
    const i = this.components.indexOf(comp);
    if (i >= 0) this.components.splice(i, 1);
  }

  // ---- truck logistics ----------------------------------------------------------

  _ensureTruck() {
    if (this.trucks.some(t => t.stage !== 'gone' && t.load.length > 0)) return;
    // never fabricate a second component for a job that already has one
    // (a RESEAT re-queues the same job — its comp still exists on site)
    const remaining = this.queue.filter(j =>
      j.delivery === 'truck' && !this.components.some(c => c.job.id === j.id));
    if (remaining.length === 0) return;
    const need = Math.min(2, remaining.length);
    const load = remaining.slice(0, need).map(j => {
      const mesh = this._makeComponent(j);
      const body = this._bodyFor(j, KIN, { x: 0, y: 100, z: 0 }); // driven by truck
      return this._register(j, body, mesh);
    });
    load.forEach(c => c.body.setBodyType(KIN)); // off-site kinematic; truck drives it
    const truck = new Truck(this.scene, load);
    this.trucks.push(truck);
    this.hud.log(`Truck ${this.trucks.length} departing yard with ${need} component(s)`, 'info');
  }

  // ---- job state machine --------------------------------------------------------

  start() {
    this.phase = 'RUNNING';
    this._nextJob();
  }

  _nextJob() {
    if (this.queue.length === 0) {
      this._finish();
      return;
    }
    const j = this.queue[0];
    const exists = this.components.some(c => c.job.id === j.id);
    // re-fabricate a RESEAT-disposed component before its job begins
    if (!exists) {
      if (j.delivery === 'truck') {
        this._ensureTruck();
      } else if (j.delivery === 'staged' && j.stagePos) {
        const mesh = this._makeComponent(j);
        const body = this._bodyFor(j, FIX, { x: j.stagePos.x, y: j.dims[1] / 2, z: j.stagePos.z });
        this._register(j, body, mesh);
      }
    }
    this.current = this.queue.shift();
    this.hud.log(`Job ${this.current.id + 1}: ${this.current.name} → ${this.current.kind.toUpperCase()}`, 'info');
    this._beginJob(this.current);
  }

  _beginJob(job) {
    const comp = this.components.find(c => c.job.id === job.id);
    if (!comp) throw new Error('component missing for job ' + job.id);
    this.job = { job, comp, step: 'DELIVERED' };
    // deliver = truck handover or staged pickup
    if (job.delivery === 'truck') {
      const truck = this.trucks.find(t => t.load.includes(comp));
      if (truck) {
        truck.handOver(comp);           // detach from bed; crane takes over
        this.scene.add(comp.mesh);
      }
      // else: re-lift of an already-handed-over component — crane flies from its resting spot
    }
    this._step();
  }

  _pickFrom(comp) {
    // where the crane will grab: component actual top
    const p = comp.body.translation();
    return new THREE.Vector3(p.x, p.y + comp.halfH, p.z);
  }

  _step(dt) {
    const { job, comp } = this.job;
    switch (this.job.step) {
      case 'DELIVERED': {
        const pick = this._pickFrom(comp);
        const pol = this.crane.polarOf(pick);
        // leave some slack above the pick point: hook comes to rigging height
        this.crane.setGoalPose({ ...pol, h: pick.y + this.crane.spread + 0.9 });
        this.job.step = 'TO_PICK';
        this.hud.setFoot(`Crane slewing to pick up ${job.name}`, 'info');
        break;
      }
      case 'TO_PICK': {
        const pick = this._pickFrom(comp);
        const pol = this.crane.polarOf(pick);
        this.crane.setGoalPose({ ...pol, h: pick.y + this.crane.spread + 0.9 });
        if (this._craneSettled()) { this.job.step = 'ATTACH'; }
        break;
      }
      case 'ATTACH': {
        comp.body.setBodyType(KIN);
        this.crane.attach(comp);
        this.job.step = 'LIFT';
        break;
      }
      case 'LIFT': {
        this.crane.setGoalPose({ theta: this.crane.theta, r: this.crane.r, h: CRUISE + 0.3 });
        // component rides below the hook; once the crane is at cruise the load is clear
        if (this._craneSettled()) this.job.step = 'TRANSIT';
        break;
      }
      case 'TRANSIT': {
        const d = job.design;
        // target: above the design center
        const pol = this.crane.polarOf(d);
        this.crane.setGoalPose({ ...pol, h: CRUISE });
        if (this._craneSettled()) {
          this.job.step = 'LOWER';
          this.hud.setFoot(`Lowering ${job.name} into position`, 'info');
        }
        break;
      }
      case 'LOWER': {
        const d = job.design;
        const pol = this.crane.polarOf(d);
        const bottom = d.y - job.dims[1] / 2;
        const hookH = bottom + job.dims[1] + this.crane.spread + GAP;
        this.crane.setGoalPose({ ...pol, h: Math.max(hookH, 0.5) });
        const pos = comp.body.translation();
        const horiz = Math.hypot(pos.x - d.x, pos.z - d.z);
        const vert = pos.y - (d.y - GAP); // height of component center above target
        // Release ONLY with the crane at rest: the comp is then at exactly
        // (d.x, d.y+GAP, d.z) with zero velocity. Releasing mid-slew imparts
        // horizontal velocity and the beam slides on impact. horiz must cover
        // the crane's own settle tolerance (0.004 rad at r≈15 ≈ 6 cm); the
        // ideal vert at rest is 2*GAP = 0.12.
        if (this._craneSettled() && horiz < 0.07 && vert < 0.2) {
          this.crane.detach();
          comp.body.setBodyType(DYN);      // gravity drop the last few cm
          this.job.step = 'SETTLE';
          this.job.t = this._stepCount;    // settle window measured in physics steps
        }
        break;
      }
      case 'SETTLE': {
        // wait ~0.7 s of PHYSICS time (speed-independent): 60 Hz * 0.7 ≈ 42 steps
        if (this._stepCount - this.job.t > 42) {
          this._validate();
        }
        break;
      }
    }
  }

  _craneSettled() {
    const g = this.crane.g;
    if (!g) return false;
    const dT = Math.atan2(Math.sin(g.theta - this.crane.theta), Math.cos(g.theta - this.crane.theta));
    return Math.abs(dT) < 0.004 && Math.abs(g.r - this.crane.r) < 0.02 && Math.abs(g.h - this.crane.h) < 0.03;
  }

  _validate() {
    const { job, comp } = this.job;
    comp.body.setBodyType(FIX);            // lock in place
    const t = comp.body.translation(), q = comp.body.rotation();
    comp.center.set(t.x, t.y, t.z);
    comp.quat = { x: q.x, y: q.y, z: q.z, w: q.w };
    const res = validatePlacement(job, comp, this.placed);
    comp.status = res.status; comp.devPos = res.devPos; comp.note = res.note;

    if (res.status === 'RESEAT' && (this.retries = this.retries + 1) <= 3) {
      this.hud.log(`${job.name} out of tolerance (${res.devPos.toFixed(2)} m) — re-fabricating`, 'warn');
      // The rejected piece is scrap: remove it so the job is re-delivered fresh
      // (dragging the damaged body back through the structure caused tumbles).
      this._disposeComp(comp);
      this.job = null;
      this.queue.unshift(job);      // same design target; re-fabricate + re-deliver
      this._nextJob();
      return;
    }
    if (res.status === 'WARN') {
      this.hud.log(`${job.name} seated with deviation ${(res.devPos * 100).toFixed(0)} cm`, 'warn');
    } else {
      this.hud.log(`${job.name} seated ✓ (dev ${(res.devPos * 100).toFixed(0)} cm)`, 'ok');
    }
    this.placed.push(comp);

    // fasten — robots bolt the connection points while the crane moves on
    const pts = this._fastenPoints(comp);
    this.robots.assign(comp, pts, () => {
      this.hud.log(`${job.name} connections fastened`, 'ok');
    });

    this.hud.setPhase(this.placed.length, this.jobs.length);
    this.hud.setVal({
      placed: this.placed.length, expected: this.jobs.length,
      maxDev: Math.max(...this.placed.map(p => p.devPos), 0),
      warn: this.placed.filter(p => p.status === 'WARN').length,
      reseat: this.retries,
    });
    this.crane.park();
    this._ensureTruck();
    this._nextJob();
  }

  /** Connection points for robots: four mid-height corners of the component. */
  _fastenPoints(comp) {
    const [w, , d] = comp.job.dims;
    const y = comp.center.y;
    const hw = w / 2 - 0.1, hd = d / 2 - 0.1;
    return [
      new THREE.Vector3(comp.center.x + hw, y, comp.center.z + hd),
      new THREE.Vector3(comp.center.x - hw, y, comp.center.z + hd),
      new THREE.Vector3(comp.center.x - hw, y, comp.center.z - hd),
      new THREE.Vector3(comp.center.x + hw, y, comp.center.z - hd),
    ];
  }

  _finish() {
    this.phase = 'DONE';
    const report = finalReport(this.placed, this.retries, this.t0);
    this.hud.report(report);
    this.hud.setFoot(`Erection complete in ${report.duration.toFixed(0)} s — structural validation ${report.passed ? 'PASS' : 'REVIEW'}`, report.passed ? 'ok' : 'warn');
    this.hud.log(`Build complete: ${report.total} components, ${report.ok} OK, ${report.warn} warnings, max dev ${(report.maxDev * 100).toFixed(0)} cm`, 'ok');
  }

  // ---- per-frame ---------------------------------------------------------------

  syncMeshes() {
    for (const comp of this.components) {
      const t = comp.body.translation(), q = comp.body.rotation();
      // only update meshes whose bodies moved (skip static ones for perf — cheap anyway)
      if (Math.abs(t.x - comp.mesh.position.x) > 1e-6 || Math.abs(t.y - comp.mesh.position.y) > 1e-6 ||
          Math.abs(t.z - comp.mesh.position.z) > 1e-6) {
        comp.mesh.position.set(t.x, t.y, t.z);
        comp.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      }
      if (this.job?.comp === comp) {
        comp.center.set(t.x, t.y, t.z);
        comp.quat = { x: q.x, y: q.y, z: q.z, w: q.w };
      }
    }
  }

  update(dt) {
    const sdt = dt * (this.speed || 1);
    for (const truck of this.trucks) truck.update(sdt);
    this.robots.update(sdt);
    this.crane.update(sdt);
    const steps = Math.min(8, Math.max(1, Math.round(sdt * 60)));
    for (let i = 0; i < steps; i++) {
      this.world.step();
      this._stepCount++;
    }
    this.syncMeshes();
    if (this.phase === 'RUNNING' && this.current && this.job) this._step(sdt);
  }
}