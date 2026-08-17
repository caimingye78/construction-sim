import * as THREE from 'three/webgpu';

// Tower crane: slewing jib + trolley + hook block.
// Hierarchy:  base(tower) -> slewing (rotates) -> jib arm; trolley slides along jib; hook hangs below.
// State machine driven by goPick/goLift/goTransit/goLower, with speed-limited easing per axis.

const STEEL = 0xd9a13b, STEEL_D = 0xb07f24, CABLE = 0x2b3440;

export class TowerCrane {
  constructor(scene, { tower = { x: -6.5, z: -6.5 }, pivotH = 28, jibLen = 21, maxR = 19.6 }) {
    this.tower = tower;
    this.pivotH = pivotH;
    this.maxR = maxR;
    this.hook = null;          // attached component {body, center, halfH} or null
    this.theta = 0.6; this.r = 6; this.h = 4;   // current crane pose
    this.g = null;             // goal {theta, r, h}
    this.spread = 1.6;         // rigging length below hook
    this._build(scene);
  }

  _build(scene) {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.35 });
    const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      return mesh;
    };

    // tower (fixed to ground)
    const towerMesh = box(1.3, this.pivotH - 1.2, 1.3, mat(0x55606b), 0, (this.pivotH - 1.2) / 2 + 1.2, 0);
    g.add(towerMesh);
    const base = box(4.5, 0.9, 4.5, mat(0x4a535d), 0, 0.45, 0);
    // truss look: darker cross-brace bands
    for (let i = 1; i < 8; i++) g.add(box(1.55, 0.12, 1.55, mat(0x3d454e), 0, i * (this.pivotH / 9), 0));
    g.add(base);
    this.base = g;

    // slewing unit: rotating tower top + jib + counter-jib + cab
    this.slewing = new THREE.Group();
    this.slewing.position.y = this.pivotH;

    const top = new THREE.Group();
    top.add(box(1.6, 2.4, 1.6, mat(STEEL), 0, -1.2, 0));                    // tower-top block
    top.add(box(2.2, 3.4, 2.2, mat(STEEL_D), 0, 0.4, 0));                    // apex
    top.add(box(0.9, 1.2, 1.3, mat(0x2b343d), 1.9, -2.4 + 1.4, 0));          // operator cab
    this.slewing.add(top);

    // jib: main boom (towards +X local), counter-jib towards -X
    this.jib = new THREE.Group();
    const jm = mat(STEEL);
    const boom = box(this.maxR + 1, 1.0, 1.1, jm, (this.maxR - 1) / 2, 0, 0);
    const boom2 = box(4, 0.55, 0.7, jm, this.maxR - 2, -0.45, 0);
    this.jib.add(boom, boom2);
    // lattice detailing: verticals along boom
    const verts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.9, 0.7), mat(STEEL_D), 14);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 14; i++) {
      m4.setPosition(((i / 13) * (this.maxR - 1) - 0.5), 0, 0);
      verts.setMatrixAt(i, m4);
    }
    this.jib.add(verts);
    // counter-jib with ballast
    const cj = new THREE.Group();
    const cjm = mat(STEEL_D);
    cj.add(box(6.5, 0.8, 1.0, cjm, -3.25, 0, 0));
    for (let i = 0; i < 3; i++) cj.add(box(1.5, 1.0, 1.0, mat(0x37404a), -1.4 - i * 1.55, -0.9, 0));
    cj.add(box(0.9, 0.8, 0.9, cjm, -5.6, 0, 0));
    this.slewing.add(this.jib, cj);

    // trolley: slides along jib; hook group hangs below it
    this.trolley = new THREE.Group();
    const tm = mat(0x37404a);
    this.trolley.add(box(0.9, 0.5, 1.2, tm));
    this.trolley.add(box(0.5, 0.9, 0.9, tm, 0, -0.6, 0));
    this.jib.add(this.trolley);

    this.hookGroup = new THREE.Group();
    this.cable = box(0.06, 1, 0.06, mat(CABLE));  // stretched vertically below
    this.hookGroup.add(this.cable);
    const hb = new THREE.Group();
    hb.add(box(0.5, 0.18, 0.5, mat(STEEL)));
    hb.add(box(0.3, 0.5, 0.3, mat(STEEL_D), 0, -0.2, 0));
    hb.add(box(1.0, 0.08, 0.14, mat(STEEL), 0, -0.5, 0));
    this.hookGroup.add(hb);
    this.trolley.add(this.hookGroup);

    scene.add(g);
    scene.add(this.slewing);
    this._applyPose();
  }

  _applyPose() {
    this.slewing.rotation.y = this.theta;
    this.trolley.position.x = Math.min(this.r, this.maxR);
    const drop = this.pivotH - this.h;
    this.hookGroup.position.y = -drop;
    this.cable.scale.y = Math.max(0.4, drop - 1.2);
    this.cable.position.y = -drop / 2;
  }

  // ---- public control --------------------------------------------------------

  /** Goal from a world position + desired hook height. */
  setGoalPose({ theta, r, h }) {
    this.g = { theta, r: Math.min(r, this.maxR), h };
  }

  /** Convert a world point to crane polar coords (theta, r) around the tower. */
  polarOf(p) {
    const dx = p.x - this.tower.x, dz = p.z - this.tower.z;
    return { theta: Math.atan2(dz, dx), r: Math.hypot(dx, dz) };
  }

  /** Closest hook height achievable for a given component top (rigging below hook). */
  hookHForTop(topY) { return topY + this.spread + 1.0; }

  /** Attach a component: it becomes kinematic and follows the hook each step. */
  attach(comp) {
    this.hook = comp;
  }
  detach() { this.hook = null; }

  /** Called each physics frame with the bound component: drive its body under the hook. */
  _driveHeld(dt) {
    const comp = this.hook;
    if (!comp) return;
    // component hangs below hook: center offset by rigging + half height
    const off = this.spread + comp.halfH;
    const p = new THREE.Vector3(
      this.tower.x + Math.cos(this.theta) * this.r,
      this.h - off,
      this.tower.z + Math.sin(this.theta) * this.r,
    );
    comp.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
    comp.body.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
  }

  /** Advance crane motion toward goal with speed limits; returns true when settled. */
  update(dt, comps) {
    this._driveHeld(dt);
    if (!this.g) return true;
    const { theta, r, h } = this.g;
    const dT = Math.atan2(Math.sin(theta - this.theta), Math.cos(theta - this.theta));
    const k = 3.2, vT = 0.85, vR = 5.0, vH = 8.0;
    const step = (cur, target, speed, dt) => {
      const e = target - cur;
      const dv = Math.max(0, Math.min(Math.abs(e) * k, speed)) * Math.sign(e) * dt; // exp approach, capped
      return cur + dv;
    };
    if (Math.abs(dT) > 0.004 || Math.abs(r - this.r) > 0.02) {
      this.theta += Math.max(-vT * dt, Math.min(vT * dt, dT * k * dt));
      this.r = step(this.r, r, vR, dt);
      // vertical only when radial/slew close (real crane behaviour)
      this.h = step(this.h, h, vH * 0.4, dt);
    } else {
      this.h = step(this.h, h, vH, dt);
    }
    this._applyPose();
    return Math.abs(dT) < 0.004 && Math.abs(r - this.r) < 0.02 && Math.abs(h - this.h) < 0.03;
  }

  /** After release: park hook up and swing back. */
  park() {
    this.g = { theta: 0.6, r: 6, h: Math.min(6, this.pivotH - 2) };
  }
}