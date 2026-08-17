// Building definition (design model) + structural validation.
// All components are axis-aligned boxes; orientation is a yaw in {0, PI/2}.

export const FLOORS = 5;
export const BAY = 8;          // footprint (m)
export const COL = 0.4;        // column section
export const FLOOR_H = 3.2;    // storey height
export const FOOT_H = 0.5;     // footing slab thickness
export const GRID = 3.8;       // column line offset from center

const P = (x, y, z, dims, kind, yaw = 0, delivery = 'truck') =>
  ({ kind, dims, yaw, delivery, design: { x, y, z } });

/** Full erection order: footing, then per floor columns -> beams -> slab -> facade. */
export function designJobs() {
  const jobs = [];

  // Footing — pre-staged next to the crane so work starts immediately.
  jobs.push({ ...P(0, FOOT_H / 2, 0, [8.4, FOOT_H, 8.4], 'footing', 0, 'staged'),
              name: 'Footing slab', floor: -1 });

  // Staged first-floor columns sit on pads too (not pre-installed).
for (let f = 0; f < FLOORS; f++) {
      // Per-floor step is 4.6 = FLOOR_H(3.2) + primary beam(0.6) +
      // secondary beam(0.6) + slab(0.2). Primary (N/S) beams sit on column
      // tops; secondary (E/W) beams sit ON the primary beam ends at the
      // corners; the slab sits on the secondary beams. Staggered heights keep
      // perpendicular beams from occupying the same volume at a corner.
      const colC = 2.1 + 4.6 * f,     // bottom = 0.5 + 4.6f (footing | prev slab top)
            beamY = 4.0 + 4.6 * f,    // primary bottom = column tops
            slabY = 5.0 + 4.6 * f,    // bottom = secondary beam tops
            facY = 2.1 + 4.6 * f;

    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      jobs.push({ ...P(sx * GRID, colC, sz * GRID, [COL, FLOOR_H, COL], 'column', 0,
                       f === 0 ? 'staged' : 'truck'),
                  name: `Column ${f + 1}.${sx > 0 ? 'E' : 'W'}${sz > 0 ? 'N' : 'S'}`, floor: f });
    }
    for (const [sx, sz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      // N/S beams run along X on the north/south faces; E/W beams along Z.
      const alongX = sz !== 0;
      // Secondary E/W beams sit ON the primary N/S beam ends (beamY + 0.6),
      // so perpendicular beams never share volume at a corner column. Full
      // BAY length: N/S ends seat on the full column top, E/W ends seat on
      // the full N/S beam thickness.
      const by = alongX ? beamY : beamY + 0.6;
      jobs.push({
        ...P(alongX ? 0 : sx * GRID, by, alongX ? sz * GRID : 0,
             alongX ? [BAY, 0.6, 0.3] : [0.3, 0.6, BAY],
             'beam', 0),
        name: `Beam ${f + 1}.${alongX ? (sz > 0 ? 'N' : 'S') : (sx > 0 ? 'E' : 'W')}`, floor: f });
    }
    jobs.push({ ...P(0, slabY, 0, [BAY, 0.2, BAY], 'slab', 0), name: `Slab ${f + 1}`, floor: f });

    for (const [sx, sz] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      // panels sit between columns: long axis = 2*(GRID - COL/2) so the released
      // 10 cm clearance each end vs column inner faces: a flush fit wedges the
      // panel between the fixed columns and leaves it suspended out of tolerance
      const len = 2 * (GRID - COL / 2) - 0.2; // 7.0
      jobs.push({
        ...P(sx * GRID, facY, sz * GRID,
             sx !== 0 ? [0.08, FLOOR_H, len] : [len, FLOOR_H, 0.08],
             'facade', 0),
        name: `Facade ${f + 1}.${sx !== 0 ? (sx > 0 ? 'E' : 'W') : (sz > 0 ? 'N' : 'S')}`, floor: f });
    }
  }
  jobs.forEach((j, i) => (j.id = i));
  return jobs;
}

/** Y of the top surface of floor f's slab (-1 -> ground). */
export function slabTop(f) {
  return FOOT_H + (f + 1) * 4.6; // column + primary + secondary beam + slab
}

export const COMP_COLOR = {
  footing: 0x7f7f79, column: 0xa8b2bd, beam: 0x8d99a6,
  slab: 0xc9c2b4, facade: 0x9ec9de,
};

// ---------------------------------------------------------------- validation

/** Rotational dev between actual quaternion and design yaw, in degrees. */
function rotDev(q, yaw) {
  // design quaternion = rotation about Y by yaw
  const w = Math.cos(yaw / 2), y = Math.sin(yaw / 2);
  const dot = Math.min(1, Math.max(-1, q.w * w + q.y * y)); // symmetrize sign
  return 2 * Math.acos(Math.abs(dot)) * 180 / Math.PI;
}

/**
 * Validate one freshly placed component against its design target.
 * @returns {{status:'OK'|'WARN'|'RESEAT', devPos:number, devRot:number, note:string}}
 */
export function validatePlacement(job, comp, placed) {
  const d = job.design, c = comp.center;
  const devPos = Math.hypot(c.x - d.x, c.y - d.y, c.z - d.z);
  const devRot = rotDev(comp.quat, job.yaw);
  const note = [];

  // --- physical support checks -------------------------------------------------
  if (job.kind === 'column') {
    const sup = placed.find(p =>
      p.job.kind === 'slab' && p.floor === job.floor - 1 &&
      Math.abs(p.center.y - (c.y - job.dims[1] / 2)) < 0.45 &&
      Math.abs(c.x - p.center.x) < p.job.dims[0] / 2 + 0.2 &&
      Math.abs(c.z - p.center.z) < p.job.dims[2] / 2 + 0.2) ??
      (job.floor === 0 ? placed.find(p => p.job.kind === 'footing') : null);
    if (!sup) note.push('no support slab below');
  }
  if (job.kind === 'beam') {
    const cols = placed.filter(p => p.job.kind === 'column' && p.floor === job.floor);
    const longAxis = (job.dims[2] > job.dims[0]) ? 'z' : 'x'; // E/W beams are long in Z
    const half = Math.max(job.dims[0], job.dims[2]) / 2 - 0.05;
    const endOk = [0, 1].map(end => {
      const s = end ? 1 : -1;
      const ex = longAxis === 'x' ? d.x + s * half : d.x;
      const ez = longAxis === 'z' ? d.z + s * half : d.z;
      return cols.some(p => Math.hypot(p.center.x - ex, p.center.z - ez) < 0.45);
    });
    if (!endOk.every(Boolean)) note.push('beam end not seated on column');
  }
  if (job.kind === 'slab') {
    // Slab rests on the secondary (E/W) beams, whose tops are flush with the
    // slab bottom; primary N/S beams sit 0.6 below and must be excluded.
    const beams = placed.filter(p => p.job.kind === 'beam' && p.floor === job.floor);
    const sup = beams.filter(b => Math.abs((b.center.y + 0.3) - (job.design.y - 0.1)) < 0.45);
    if (sup.length < 2) note.push('slab not resting on beams');
  }
  if (job.kind === 'facade') {
    const cols = placed.filter(p => p.job.kind === 'column' && p.floor === job.floor);
    if (cols.length < 4) note.push('columns not yet in place');
  }

  // --- verdict ----------------------------------------------------------------
  if (note.length === 0 && devPos > 0.25) note.push(`drifted ${devPos.toFixed(2)} m`);
  if (note.length > 0 || devPos > 0.25 || devRot > 5) return { status: 'RESEAT', devPos, devRot, note };
  if (devPos > 0.08 || devRot > 1.5) return { status: 'WARN', devPos, devRot, note };
  return { status: 'OK', devPos, devRot, note: [] };
}

/** Final structural report over all placed components. */
export function finalReport(placed, retries, startTime) {
  let ok = 0, warn = 0, reseat = 0, maxDev = 0;
  for (const p of placed) {
    if (p.status === 'RESEAT') reseat++;
    else if (p.status === 'WARN') warn++;
    else ok++;
    maxDev = Math.max(maxDev, p.devPos);
  }
  const secs = (Date.now() - startTime) / 1000;
  const passed = reseat === 0 && maxDev < 0.25;
  return {
    total: placed.length, ok, warn, reseat, maxDev,
    retries, duration: secs, passed,
    verdict: passed
      ? `All ${placed.length} components seated and validated. Max positional deviation ${(maxDev * 100).toFixed(0)} cm. Load paths verified through 5 storeys.`
      : `Erection finished with ${reseat} component(s) out of tolerance (max dev ${(maxDev * 100).toFixed(0)} cm). Manual inspection advised.`,
  };
}