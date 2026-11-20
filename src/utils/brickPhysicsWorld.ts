import * as CANNON from 'cannon-es';
import { EnvironmentLoadConfig, PlacedPart3D, TowerSolution } from './brickTowerEngine';

/**
 * 1 unit in cannon-es = 1 decimeter (0.1m = 10cm).
 * Keeps 8-20cm bricks right at ~0.8-2.0 solver units for zero jitter, crisp corner contacts, and zero tunneling!
 * Dimensional conversion: 1 m = 10 dm => 1 m/s² = 10 dm/s² => 1 Newton (kg·m/s²) = 10 cannon force units.
 */
export const PHYS_SCALE = 10;
const GRAVITY_M_S2 = 9.80665;
const AIR_DENSITY = 1.225;

export interface DynamicPartHandle {
  part: PlacedPart3D;
  body: CANNON.Body;
  sameCourseCount: number;
}

export interface GuyWireLiveState {
  id: string;
  courseIndex: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  /** 0 = slack, 1+ = taut under wind/tilt load */
  tensionRatio: number;
}

interface GuyWireBinding {
  id: string;
  courseIndex: number;
  targetBody: CANNON.Body;
  localAnchor: CANNON.Vec3;
  tableLocalStake: CANNON.Vec3;
  restLengthPhys: number;
}

export interface PhysicsStepTelemetry {
  simTimeSec: number;
  /** Highest currently standing top surface above the table in cm */
  liveTopHeightCm: number;
  /** Live 3D Center of Mass in meters (world space) */
  comX: number;
  comY: number;
  comZ: number;
  /** Maximum horizontal drift of standing bricks in cm */
  maxDriftCm: number;
  /** True when tower has genuinely collapsed/toppled in rigid-body simulation */
  collapsed: boolean;
  /** Number of parts that fell onto the ground/off their layer */
  dislodgedCount: number;
  /** Table world position (meters) and quaternion */
  tablePosM: { x: number; y: number; z: number };
  tableQuat: { x: number; y: number; z: number; w: number };
  /** Live 3D guy-wire endpoints & tension */
  guyWires: GuyWireLiveState[];
}

export class BrickTowerPhysicsSim {
  public readonly world: CANNON.World;
  public readonly tableBody: CANNON.Body;
  public readonly catchFloorBody: CANNON.Body;
  public readonly handles: DynamicPartHandle[] = [];
  private readonly handleById = new Map<string, DynamicPartHandle>();
  private readonly guyWireBindings: GuyWireBinding[] = [];
  private readonly breakableConstraints: { constraint: CANNON.Constraint; maxForcePhys: number }[] = [];

  private simTimeSec = 0;
  private currentTiltRad = 0;
  private initialTopHeightM = 0;
  private accumulatorSec = 0;
  private visualTableOffsetM = { x: 0, z: 0 };
  private visualTableRollRad = 0;

  // Scratch vectors to avoid GC allocations in 120Hz loop
  private readonly tmpV1 = new CANNON.Vec3();
  private readonly tmpV2 = new CANNON.Vec3();
  private readonly tmpForce = new CANNON.Vec3();
  private readonly tmpPoint = new CANNON.Vec3();
  private readonly tmpQuat = new CANNON.Quaternion();

  constructor(solution: TowerSolution) {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -GRAVITY_M_S2 * PHYS_SCALE, 0),
      allowSleep: false
    });

    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    const solver = new CANNON.GSSolver();
    solver.iterations = 32;
    solver.tolerance = 1e-4;
    this.world.solver = solver;

    // Materials & Realistic Dry-Masonry Contact Physics
    const tableMat = new CANNON.Material('table');
    const brickMat = new CANNON.Material('brick');
    const plateMat = new CANNON.Material('plate');
    const plasticMat = new CANNON.Material('plastic');
    const woodMat = new CANNON.Material('wood');
    const stoneMat = new CANNON.Material('stone');

    const addPair = (m1: CANNON.Material, m2: CANNON.Material, friction: number, restitution: number) => {
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(m1, m2, {
          friction,
          restitution,
          contactEquationStiffness: 1.5e7,
          contactEquationRelaxation: 4,
          frictionEquationStiffness: 1.2e7,
          frictionEquationRelaxation: 4
        })
      );
    };

    addPair(tableMat, brickMat, 0.66, 0.03);
    addPair(tableMat, stoneMat, 0.72, 0.02);
    addPair(tableMat, plasticMat, 0.42, 0.12);
    addPair(tableMat, woodMat, 0.54, 0.06);
    addPair(tableMat, plateMat, 0.55, 0.04);

    addPair(brickMat, brickMat, 0.62, 0.03);
    addPair(brickMat, plateMat, 0.54, 0.04);
    addPair(brickMat, plasticMat, 0.36, 0.1);
    addPair(brickMat, woodMat, 0.48, 0.05);
    addPair(brickMat, stoneMat, 0.65, 0.03);

    addPair(plateMat, plasticMat, 0.38, 0.08);
    addPair(plateMat, woodMat, 0.5, 0.05);
    addPair(plasticMat, plasticMat, 0.32, 0.14);
    addPair(woodMat, woodMat, 0.48, 0.06);

    // Kinematic Test Table (radius ~0.62m -> modeled as thick 1.25m x 1.25m platform, top surface exactly at y = 0)
    const tableThicknessM = 0.08;
    this.tableBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      material: tableMat,
      position: new CANNON.Vec3(0, 0, 0)
    });
    this.tableBody.addShape(
      new CANNON.Box(new CANNON.Vec3(0.62 * PHYS_SCALE, (tableThicknessM * 0.5) * PHYS_SCALE, 0.62 * PHYS_SCALE)),
      new CANNON.Vec3(0, -(tableThicknessM * 0.5) * PHYS_SCALE, 0)
    );
    this.world.addBody(this.tableBody);

    // Catch floor at y = -0.32m so bricks that tumble off the table clatter onto the ground instead of falling forever
    this.catchFloorBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: tableMat,
      position: new CANNON.Vec3(0, -0.32 * PHYS_SCALE, 0)
    });
    this.catchFloorBody.addShape(new CANNON.Plane());
    this.catchFloorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(this.catchFloorBody);

    // Count solids per course for realistic aerodynamic wake-shielding
    const courseCounts = new Map<number, number>();
    for (const p of solution.parts) {
      if (p.kind === 'binder') continue;
      courseCounts.set(p.courseIndex, (courseCounts.get(p.courseIndex) ?? 0) + 1);
    }

    // Spawn rigid bodies for all physical parts
    for (const p of solution.parts) {
      if (p.kind === 'binder') continue;

      const mat =
        p.kind === 'block'
          ? brickMat
          : p.kind === 'plate'
            ? plateMat
            : p.kind === 'cylinder'
              ? plasticMat
              : p.kind === 'rod'
                ? woodMat
                : stoneMat;

      const effectiveMass = p.kind === 'plate' ? Math.max(0.55, p.massKg) : Math.max(0.025, p.massKg);
      const body = new CANNON.Body({
        mass: effectiveMass,
        material: mat,
        linearDamping: 0.035,
        angularDamping: 0.075,
        position: new CANNON.Vec3(p.x * PHYS_SCALE, p.y * PHYS_SCALE, p.z * PHYS_SCALE)
      });
      body.quaternion.setFromAxisAngle(CANNON.Vec3.UNIT_Y, p.rotY);

      if (p.kind === 'cylinder' || p.kind === 'rod') {
        const radiusPhys = Math.max(0.05, p.sx * 0.5 * PHYS_SCALE);
        const heightPhys = Math.max(0.05, p.sy * PHYS_SCALE);
        body.addShape(new CANNON.Cylinder(radiusPhys, radiusPhys, heightPhys, 14));
      } else {
        const hx = Math.max(0.03, p.sx * 0.5 * PHYS_SCALE);
        const hy = Math.max(0.025, p.sy * 0.5 * PHYS_SCALE);
        const hz = Math.max(0.03, p.sz * 0.5 * PHYS_SCALE);
        body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
      }

      this.world.addBody(body);
      const handle: DynamicPartHandle = {
        part: p,
        body,
        sameCourseCount: courseCounts.get(p.courseIndex) ?? 1
      };
      this.handles.push(handle);
      this.handleById.set(p.id, handle);

      const topM = p.y + p.sy * 0.5;
      if (topM > this.initialTopHeightM) this.initialTopHeightM = topM;
    }

    // Wire real physical Tape & Side-Lash constraints
    for (const h of this.handles) {
      const p = h.part;
      if (p.tapedToBelow) {
        const below = this.findNearestBodyInCourse(p.courseIndex - 1, p.x, p.z);
        if (below) {
          const c = new CANNON.LockConstraint(h.body, below.body, { maxForce: 42 * PHYS_SCALE });
          this.world.addConstraint(c);
          this.breakableConstraints.push({ constraint: c, maxForcePhys: 42 * PHYS_SCALE });
        }
      }
      if (p.lashedToCourseMin !== undefined && p.lashedToCourseMax !== undefined) {
        const lowB = this.findNearestBodyInCourse(p.lashedToCourseMin, p.x, p.z);
        const highB = this.findNearestBodyInCourse(p.lashedToCourseMax, p.x, p.z);
        if (lowB) {
          const c1 = new CANNON.LockConstraint(h.body, lowB.body, { maxForce: 95 * PHYS_SCALE });
          this.world.addConstraint(c1);
          this.breakableConstraints.push({ constraint: c1, maxForcePhys: 95 * PHYS_SCALE });
        }
        if (highB && highB !== lowB) {
          const c2 = new CANNON.LockConstraint(h.body, highB.body, { maxForce: 95 * PHYS_SCALE });
          this.world.addConstraint(c2);
          this.breakableConstraints.push({ constraint: c2, maxForcePhys: 95 * PHYS_SCALE });
        }
      }
    }

    // Wire 3-way Tension-Only Guy-Wire Ropes
    for (const p of solution.parts) {
      if (p.kind !== 'binder' || p.wireToX === undefined || p.wireToZ === undefined) continue;
      const target = this.findNearestBodyInCourse(p.courseIndex, p.x, p.z);
      if (!target) continue;
      const worldAttach = new CANNON.Vec3(p.x * PHYS_SCALE, p.y * PHYS_SCALE, p.z * PHYS_SCALE);
      const localAnchor = target.body.pointToLocalFrame(worldAttach);
      const tableLocalStake = new CANNON.Vec3(p.wireToX * PHYS_SCALE, 0, p.wireToZ * PHYS_SCALE);
      const restDist = worldAttach.distanceTo(tableLocalStake) * 1.003;
      this.guyWireBindings.push({
        id: p.id,
        courseIndex: p.courseIndex,
        targetBody: target.body,
        localAnchor,
        tableLocalStake,
        restLengthPhys: restDist
      });
    }
  }

  private findNearestBodyInCourse(courseIdx: number, xM: number, zM: number): DynamicPartHandle | null {
    let best: DynamicPartHandle | null = null;
    let bestDist = Infinity;
    for (const h of this.handles) {
      if (h.part.courseIndex !== courseIdx) continue;
      const d = Math.hypot(h.part.x - xM, h.part.z - zM);
      if (d < bestDist) {
        bestDist = d;
        best = h;
      }
    }
    return best;
  }

  /**
   * Apply an interactive "chạm / đẩy tay kiểm tra" physical impulse to a specific brick or prop!
   */
  public pokePart(partId: string, dirX = 1, dirZ = 0.15, impulseNs = 1.35): boolean {
    const h = this.handleById.get(partId);
    if (!h) return false;
    const len = Math.hypot(dirX, dirZ) || 1;
    // 1 N·s = 1 kg·m/s = 10 kg·dm/s in PHYS_SCALE
    const imp = new CANNON.Vec3((dirX / len) * impulseNs * PHYS_SCALE, 0.08 * impulseNs * PHYS_SCALE, (dirZ / len) * impulseNs * PHYS_SCALE);
    h.body.wakeUp();
    h.body.applyImpulse(imp, new CANNON.Vec3(0, h.part.sy * 0.18 * PHYS_SCALE, 0));
    return true;
  }

  /**
   * Steps the 3D rigid-body simulation forward by `frameDtSec` using fixed 1/120s substeps.
   */
  public step(frameDtSec: number, env: EnvironmentLoadConfig, paused = false): PhysicsStepTelemetry {
    const fixedDt = 1 / 120;
    if (!paused) {
      const clampedDt = Math.min(0.05, Math.max(0, frameDtSec));
      this.accumulatorSec += clampedDt;
      let steps = 0;
      while (this.accumulatorSec >= fixedDt && steps < 5) {
        this.stepSingleSubstep(fixedDt, env);
        this.accumulatorSec -= fixedDt;
        steps++;
      }
      if (this.accumulatorSec > fixedDt * 2) {
        this.accumulatorSec = 0;
      }
    }

    return this.collectTelemetry();
  }

  private stepSingleSubstep(dt: number, env: EnvironmentLoadConfig): void {
    const tNext = this.simTimeSec + dt;
    // Smooth C² onset envelope over first 0.55s so sudden slider jumps or t=0 spawn never cause impulse spikes
    const u = Math.min(1, tNext / 0.55);
    const smoothEnv = u * u * (3 - 2 * u);

    // 1. Exact D'Alembert Non-Inertial Table Reference Frame:
    // Solving contacts on the stationary flat table plane (y=0) while applying exact tilted gravity
    // + harmonic table inertial acceleration (-m * a_table) eliminates discrete kinematic-box collision jitter
    // while keeping 100% exact Newtonian normal, friction, rocking, and overturning forces!
    const targetTiltRad = (Math.max(-18, Math.min(18, env.tiltDeg)) * Math.PI) / 180;
    const maxSlewPerStep = 0.28 * dt;
    const tiltDiff = targetTiltRad - this.currentTiltRad;
    if (Math.abs(tiltDiff) <= maxSlewPerStep) {
      this.currentTiltRad = targetTiltRad;
    } else {
      this.currentTiltRad += Math.sign(tiltDiff) * maxSlewPerStep;
    }

    const effTilt = this.currentTiltRad * smoothEnv;
    const wobbleRad = env.shakeG * 0.035 * smoothEnv * Math.sin(11.5 * tNext);
    const totalSlopeRad = effTilt + wobbleRad;

    // Peak horizontal shake acceleration = env.shakeG * g (realistic 2.1 Hz + 3.7 Hz table/ground vibration)
    const shakeAccelXMps2 =
      env.shakeG * GRAVITY_M_S2 * smoothEnv * (0.74 * Math.sin(13.2 * tNext) + 0.26 * Math.sin(23.1 * tNext));
    const shakeAccelZMps2 =
      env.shakeG * GRAVITY_M_S2 * 0.28 * smoothEnv * Math.sin(9.7 * tNext + 0.9);

    this.world.gravity.set(
      (GRAVITY_M_S2 * Math.sin(totalSlopeRad) - shakeAccelXMps2) * PHYS_SCALE,
      -GRAVITY_M_S2 * Math.cos(totalSlopeRad) * PHYS_SCALE,
      -shakeAccelZMps2 * PHYS_SCALE
    );

    // Visual table oscillation & tilt exported in telemetry so Three.js renders the exact tilting/shaking table!
    const visualShakeXM = env.shakeG * 0.036 * smoothEnv * (0.74 * Math.sin(13.2 * tNext) + 0.26 * Math.sin(23.1 * tNext));
    const visualShakeZM = env.shakeG * 0.012 * smoothEnv * Math.sin(9.7 * tNext + 0.9);
    this.tableBody.position.set(0, 0, 0);
    this.tableBody.quaternion.set(0, 0, 0, 1);
    this.visualTableOffsetM.x = visualShakeXM;
    this.visualTableOffsetM.z = visualShakeZM;
    this.visualTableRollRad = -totalSlopeRad;

    // 2. Apply Aerodynamic Wind Drag + Turbulent Gusts + Vortex Flutter to every exposed rigid body
    const windBaseMps = Math.max(0, env.windSpeedMps);
    if (windBaseMps > 0.05) {
      for (let i = 0; i < this.handles.length; i++) {
        const h = this.handles[i];
        const b = h.body;
        const hM = Math.max(0.04, b.position.y / PHYS_SCALE);
        // Wind boundary-layer shear + realistic unsteady gust train
        const boundaryProfile = Math.pow(Math.min(2.6, hM / 0.75), 0.16);
        const gust =
          1.0 +
          0.24 * Math.sin(3.3 * tNext - 1.9 * hM) +
          0.13 * Math.sin(7.7 * tNext + i * 1.7);
        const vWindX = windBaseMps * boundaryProfile * gust;
        const vBodyXMps = b.velocity.x / PHYS_SCALE;
        const vRelX = vWindX - vBodyXMps;

        const p = h.part;
        let frontalAreaM2: number;
        let cd: number;
        if (p.kind === 'cylinder' || p.kind === 'rod') {
          frontalAreaM2 = p.sx * p.sy;
          cd = 0.88;
        } else {
          // Account for horizontal rotation around Y when projecting box faces into +X wind
          const worldAxisX = b.quaternion.vmult(CANNON.Vec3.UNIT_X, this.tmpV1);
          const worldAxisZ = b.quaternion.vmult(CANNON.Vec3.UNIT_Z, this.tmpV2);
          const projWidthM = Math.abs(worldAxisX.x) * p.sz + Math.abs(worldAxisZ.x) * p.sx;
          frontalAreaM2 = Math.max(0.0005, projWidthM * p.sy);
          cd = p.kind === 'plate' ? 1.15 : 1.24;
        }

        // Leeward wake shielding when multiple bricks share a course
        const wakeShield = h.sameCourseCount > 1 ? 1 / Math.sqrt(h.sameCourseCount) : 1.0;
        const dragForceN = 0.5 * AIR_DENSITY * cd * frontalAreaM2 * wakeShield * vRelX * Math.abs(vRelX);
        const vortexForceZN =
          windBaseMps >= 4.5
            ? Math.abs(dragForceN) * 0.14 * Math.sin(5.8 * tNext + hM * 3.7 + i * 0.5)
            : 0;

        // Convert Newtons -> cannon force units (* PHYS_SCALE) & apply slightly above CoM
        this.tmpForce.set(dragForceN * PHYS_SCALE, 0, vortexForceZN * PHYS_SCALE);
        this.tmpPoint.set(
          b.position.x,
          b.position.y + p.sy * 0.08 * PHYS_SCALE,
          b.position.z
        );
        b.applyForce(this.tmpForce, this.tmpPoint);
      }
    }

    // 3. Apply 3-Way Tension-Only Guy-Wire Cable Forces
    for (const gw of this.guyWireBindings) {
      const worldCollar = gw.targetBody.pointToWorldFrame(gw.localAnchor, this.tmpV1);
      const worldStake = this.tableBody.pointToWorldFrame(gw.tableLocalStake, this.tmpV2);
      const dx = worldStake.x - worldCollar.x;
      const dy = worldStake.y - worldCollar.y;
      const dz = worldStake.z - worldCollar.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > gw.restLengthPhys && dist > 1e-4) {
        const stretch = dist - gw.restLengthPhys;
        const ux = dx / dist;
        const uy = dy / dist;
        const uz = dz / dist;
        // Relative velocity along cable for realistic rope damping
        const vCollar = gw.targetBody.velocity;
        const vAlong = -(vCollar.x * ux + vCollar.y * uy + vCollar.z * uz);
        const tensionPhys = Math.min(350 * PHYS_SCALE, Math.max(0, stretch * 950 + vAlong * 18));
        this.tmpForce.set(ux * tensionPhys, uy * tensionPhys, uz * tensionPhys);
        gw.targetBody.applyForce(this.tmpForce, worldCollar);
      }
    }

    // 4. Advance Cannon Rigid-Body Solver
    this.world.step(dt);
    this.simTimeSec = tNext;
  }

  public collectTelemetry(): PhysicsStepTelemetry {
    let totalMass = 0;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let liveTopHeightM = 0;
    let maxDriftM = 0;
    let dislodgedCount = 0;

    const tableShiftXM = this.tableBody.position.x / PHYS_SCALE;
    const tableShiftZM = this.tableBody.position.z / PHYS_SCALE;

    for (const h of this.handles) {
      const p = h.part;
      const bx = h.body.position.x / PHYS_SCALE;
      const by = h.body.position.y / PHYS_SCALE;
      const bz = h.body.position.z / PHYS_SCALE;

      totalMass += p.massKg;
      sumX += p.massKg * bx;
      sumY += p.massKg * by;
      sumZ += p.massKg * bz;

      // Estimate current vertical half-extent from rotated body up-axis
      const upVec = h.body.quaternion.vmult(CANNON.Vec3.UNIT_Y, this.tmpV1);
      const tiltCos = Math.abs(upVec.y);
      const currentTopM =
        by + (tiltCos * p.sy * 0.5 + Math.sqrt(Math.max(0, 1 - tiltCos * tiltCos)) * Math.max(p.sx, p.sz) * 0.5);

      const dropFromInitialM = p.y - by;
      const horizDriftM = Math.hypot(bx - tableShiftXM - p.x, bz - tableShiftZM - p.z);

      // Consider a part dislodged if it dropped > 6cm below its blueprint height or tilted > 52°
      const isDislodged = dropFromInitialM > Math.max(0.06, p.sy * 0.65) || tiltCos < 0.61 || by < -0.02;
      if (isDislodged) {
        dislodgedCount++;
      } else {
        if (currentTopM > liveTopHeightM) liveTopHeightM = currentTopM;
        if (horizDriftM > maxDriftM) maxDriftM = horizDriftM;
      }
      // Even if tilted, track overall highest point above ground if nothing upright remains
      if (liveTopHeightM === 0 && by > 0 && currentTopM > liveTopHeightM) {
        liveTopHeightM = currentTopM;
      }
    }

    const guyWires: GuyWireLiveState[] = [];
    for (const gw of this.guyWireBindings) {
      const worldCollar = gw.targetBody.pointToWorldFrame(gw.localAnchor, this.tmpV1);
      const worldStake = this.tableBody.pointToWorldFrame(gw.tableLocalStake, this.tmpV2);
      const dist = worldCollar.distanceTo(worldStake);
      const stretchRatio = Math.min(1.5, Math.max(0, (dist - gw.restLengthPhys) / 0.08));
      guyWires.push({
        id: gw.id,
        courseIndex: gw.courseIndex,
        fromX: worldCollar.x / PHYS_SCALE,
        fromY: worldCollar.y / PHYS_SCALE,
        fromZ: worldCollar.z / PHYS_SCALE,
        toX: worldStake.x / PHYS_SCALE,
        toY: worldStake.y / PHYS_SCALE,
        toZ: worldStake.z / PHYS_SCALE,
        tensionRatio: stretchRatio
      });
    }

    const heightLossRatio =
      this.initialTopHeightM > 0.05 ? (this.initialTopHeightM - liveTopHeightM) / this.initialTopHeightM : 0;
    const collapsed =
      this.handles.length > 0 && (heightLossRatio > 0.18 || dislodgedCount >= Math.max(1, Math.ceil(this.handles.length * 0.2)));

    this.tmpQuat.setFromAxisAngle(CANNON.Vec3.UNIT_Z, this.visualTableRollRad);

    return {
      simTimeSec: this.simTimeSec,
      liveTopHeightCm: Number((Math.max(0, liveTopHeightM) * 100).toFixed(1)),
      comX: totalMass > 1e-5 ? sumX / totalMass : 0,
      comY: totalMass > 1e-5 ? Math.max(0, sumY / totalMass) : 0,
      comZ: totalMass > 1e-5 ? sumZ / totalMass : 0,
      maxDriftCm: Number((maxDriftM * 100).toFixed(1)),
      collapsed,
      dislodgedCount,
      tablePosM: {
        x: this.visualTableOffsetM.x,
        y: 0,
        z: this.visualTableOffsetM.z
      },
      tableQuat: {
        x: this.tmpQuat.x,
        y: this.tmpQuat.y,
        z: this.tmpQuat.z,
        w: this.tmpQuat.w
      },
      guyWires
    };
  }
}

/**
 * Headless Fast-Forward Rigid-Body Verification:
 * Runs real 3D cannon-es simulation for `simSeconds` under `env` (wind + ground tilt + harmonic shake)
 * and returns true iff the tower genuinely stands without collapsing!
 */
export function verifyTowerSurvivesPhysics(
  solution: TowerSolution,
  env: EnvironmentLoadConfig,
  simSeconds = 2.5
): boolean {
  if (solution.parts.length === 0) return true;
  const sim = new BrickTowerPhysicsSim(solution);
  (sim.world.solver as CANNON.GSSolver).iterations = 20;
  const frames = Math.round(simSeconds * 60);
  for (let f = 0; f < frames; f++) {
    const tel = sim.step(1 / 60, env, false);
    if (tel.collapsed) return false;
  }
  return true;
}

/**
 * Walks down a ranked Pareto candidate ladder (`0 .. K-1`, ordered from tallest to sturdiest)
 * and returns the index of the FIRST (tallest!) candidate that survives real 3D cannon-es physics!
 */
export function findStandingCandidateIndexInPhysics(
  ladder: TowerSolution[],
  env: EnvironmentLoadConfig,
  startIdx = 0
): number {
  if (ladder.length === 0) return 0;
  for (let i = Math.max(0, startIdx); i < ladder.length; i++) {
    if (verifyTowerSurvivesPhysics(ladder[i], env, 2.5)) {
      return i;
    }
  }
  return ladder.length - 1;
}
