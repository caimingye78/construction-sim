import * as THREE from 'three/webgpu';

// Delivery trucks and fastening robots.
// Truck bodies are driven as Rapier kinematic bodies so the crane can pick straight off the bed.

const ROT = (n) => new THREE.MeshStandardMaterial({ color: n, roughness: 0.6, metalness: 0.2 });
const IDENT = { x: 0, y: 0, z: 0, w: 1 };

/** Flatbed delivery truck carrying up to N components, driving to a drop bay. */
export class Truck {
  constructor(scene, load) {
    this.load = load;               // components on the bed
    this.slots = load.map((comp, i) => ({ comp, dx: 0.6 - i * 1.6 }));
    this.x = -46; this.speed = 0;
    this.stage = 'arriving';        // arriving | waiting | departing | gone
    this.waitT = 0;
    this.group = new THREE.Group();
    this.group.position.z = -10.5;
    this.bedTop = 1.8;

    const g = this.group;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.3, 2.5), ROT(0xf2a83c));
    cab.position.set(3.2, 1.4, 0);
    g.add(cab);
    const cabTop = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 2.6), ROT(0xf2a83c));
    cabTop.position.set(2.9, 0.35, 0);
    g.add(cabTop);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(9, 1.0, 2.7), ROT(0x6d7680));
    bed.position.set(-2.2, 1.3, 0);
    g.add(bed);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 12),
      new THREE.MeshStandardMaterial({ color: 0x191c20, roughness: 0.9 }));
    wheel.rotation.z = Math.PI / 2;
    for (const [wx, wz] of [[3.6, -1.15], [3.6, 1.15], [-5.6, -1.15], [-5.6, 1.15]]) {
      const w = wheel.clone(); w.position.set(wx, 0.55, wz); g.add(w);
    }
    const hl = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe9a8, emissiveIntensity: 0.6 });
    for (const wz of [-0.95, 0.95]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), hl);
      l.position.set(4.45, 1.15, wz); g.add(l);
    }
    scene.add(g);
  }

  /** True if the crane has taken this component off the bed. */
  handOver(comp) {
    const i = this.load.indexOf(comp);
    if (i < 0) return false;
    this.load.splice(i, 1);
    this.slots = this.slots.filter(s => s.comp !== comp);
    return true;
  }

  update(dt) {
    if (this.stage === 'arriving') {
      this.speed = Math.min(7, this.speed + 9 * dt);
      this.x += this.speed * dt;
      if (this.x >= 11.5) { this.x = 11.5; this.stage = 'waiting'; }
    } else if (this.stage === 'departing') {
      this.speed = Math.max(0, this.speed - 9 * dt);
      this.x += this.speed * dt;
      if (this.x <= -46) { this.stage = 'gone'; }
    } else if (this.stage === 'waiting') {
      this.waitT += dt;
      if (this.load.length === 0 && this.waitT > 0.8) this.stage = 'departing';
    }
    this.group.position.x = this.x;
    // drive bodies on the bed (kinematic) — meshes follow via sim.syncMeshes
    for (const { comp, dx } of this.slots) {
      comp.body.setNextKinematicTranslation({ x: this.x + dx, y: this.bedTop + comp.halfH, z: -10.5 });
      comp.body.setNextKinematicRotation(IDENT);
    }
    this.group.children.filter(c => c.geometry?.type === 'CylinderGeometry')
      .forEach(w => w.rotation.x += this.speed * dt / 0.55);
  }
}

/** Fleet of fastening drones that bolt a component's connection points. */
export class RobotFleet {
  constructor(scene, n = 2) {
    this.robots = [];
    this.flashes = [];
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.9), ROT(0x2f3b46));
      g.add(body);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 16),
        new THREE.MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.4 }));
      for (const rx of [-0.6, 0.6]) {
        const r1 = rotor.clone(); r1.position.set(rx, -0.3, 0); g.add(r1);
      }
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffb03a, emissive: 0xffb03a, emissiveIntensity: 1.2 }));
      light.position.set(0, 0.24, 0);
      g.add(light);
      g.position.set(-10, 6, -10 + i * 4);
      scene.add(g);
      this.robots.push({
        group: g, home: g.position.clone(), pos: g.position.clone(),
        queue: [], arr: 0,
        rotors: g.children.filter(c => c.geometry?.type === 'CylinderGeometry'),
      });
    }
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffcf6e, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), flashMat.clone());
      s.visible = false; scene.add(s); this.flashes.push(s);
    }
  }

  /** Send robots to fasten at the given world points; onDone fires when all bolts are driven. */
  assign(comp, points, onDone) {
    let remaining = points.length;
    const finish = () => { if (--remaining === 0) onDone(); };
    points.forEach((p, i) => {
      const robot = this.robots[i % this.robots.length];
      robot.queue.push({ p, done: finish, delay: 0.15 * i, arrived: false });
    });
  }

  update(dt) {
    const S = 3.4;
    for (const rb of this.robots) {
      for (const r of rb.rotors) r.rotation.y += dt * 40;
      let target = rb.home;
      if (rb.queue.length > 0) {
        const item = rb.queue[0];
        target = item.p;
        const dist = rb.pos.distanceTo(item.p);
        if (dist < 0.05) {
          if (!item.arrived) { item.arrived = true; item.t = 0; }
          item.t += dt;
          if (item.t > item.delay) {
            this._flash(item.p);
            rb.queue.shift();
            item.done();
          }
        }
      }
      const dir = target.clone().sub(rb.pos);
      const dist = dir.length();
      if (dist > 0.02) {
        const step = Math.min(dist, S * dt);
        dir.normalize().multiplyScalar(step);
        rb.pos.add(dir);
      }
      rb.group.position.copy(rb.pos);
      rb.group.lookAt(target.x, rb.pos.y, target.z);
    }
    for (const f of this.flashes) {
      if (f.visible) {
        f.userData.life -= dt;
        f.material.opacity = Math.max(0, f.userData.life / 0.28);
        const s = 1 + (0.28 - f.userData.life) * 6;
        f.scale.set(s, s, s);
        if (f.userData.life <= 0) f.visible = false;
      }
    }
  }

  _flash(p) {
    const f = this.flashes.find(f => !f.visible);
    if (!f) return;
    f.visible = true;
    f.position.copy(p);
    f.material.opacity = 1;
    f.userData.life = 0.28;
  }
}