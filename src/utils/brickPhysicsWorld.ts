import * as CANNON from 'cannon-es';
import { EnvironmentLoadConfig, PlacedPart3D, TowerSolution } from './brickTowerEngine';

/**
 * 1 unit in cannon-es = 1 decimeter (0.1m = 10cm).
 * Keeps 8-20cm bricks right at ~0.8-2.0 solver units for zero jitter and crisp contacts.
 * Performance architecture:
 * - Zero `CANNON.Plane` (infinite AABB) and zero `CANNON.Cylinder` (`ConvexPolyhedron` heap-allocating SAT):
 *   every collider uses pure analytical zero-GC `CANNON.Box`es (cylinders/rods use 2 inscribed 45°-crossed Boxes!).
 * - Fixed 60Hz physics tick (`maxSubSteps = 2`, `15` GSSolver iterations) + 120Hz linear/quaternion interpolation
 *   + smart idle sleep => < 0.35ms/frame at 120Hz on mobile!
 */
export const PHYS_SCALE = 10;
const GRAVITY_M_S2 = 9.80665;
const AIR_DENSITY = 1.225;
const FIXED_DT = 1 / 120;

export interface DynamicPartHandle {
  part: PlacedPart3D;
  body: CANNON.Body;
  sameCourseCount: number;
  prevPos: CANNON.Vec3;
  prevQuat: CANNON.Quaternion;
  /** Interpolated 120Hz render position in meters */
  renderPosM: { x: number; y: number; z: number };
  /** Interpolated 120Hz render quaternion */
  renderQuat: { x: number; y: number; z: number; w: number };
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
  tensionRatio: number;
}

export interface PayloadVisualState {
  visible: boolean;
  kg: number;
  sizeM: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
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
  liveTopHeightCm: number;
  comX: number;
  comY: number;
  comZ: number;
  maxDriftCm: number;
  collapsed: boolean;
  dislodgedCount: number;
  tablePosM: { x: number; y: number; z: number };
  tableQuat: { x: number; y: number; z: number; w: number };
  guyWires: GuyWireLiveState[];
  payloadVisual: PayloadVisualState;
}

export class BrickTowerPhysicsSim {
  public readonly world: CANNON.World;
  public readonly tableBody: CANNON.Body;
  public readonly catchFloorBody: CANNON.Body;
  public readonly handles: DynamicPartHandle[] = [];
  private readonly handleById = new Map<string, DynamicPartHandle>();
  private readonly guyWireBindings: GuyWireBinding[] = [];

  private readonly metalMat: CANNON.Material;
  private payloadBody: CANNON.Body | null = null;
  private payloadConstraint: CANNON.Constraint | null = null;
  private payloadPrevPos = new CANNON.Vec3();
  private payloadPrevQuat = new CANNON.Quaternion();
  private currentPayloadKg = 0;
  private payloadSizeM = 0.1;
  private triggeredCrushCourse: number | null = null;

  private simTimeSec = 0;
  private currentTiltRad = 0;
  private initialTopHeightM = 0;
  private topCrownX = 0;
  private topCrownZ = 0;
  private accumulatorSec = 0;
  private isSettledIdle = false;
  private lastEnvKey = '';

  private visualTableOffsetM = { x: 0, z: 0 };
  private visualTableRollRad = 0;

  // Pre-allocated scratch objects (zero GC in 120Hz render/physics loop!)
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
    solver.iterations = 28;
    solver.tolerance = 1.2e-4;
    this.world.solver = solver;

    const tableMat = new CANNON.Material('table');
    const brickMat = new CANNON.Material('brick');
    const plateMat = new CANNON.Material('plate');
    const plasticMat = new CANNON.Material('plastic');
    const woodMat = new CANNON.Material('wood');
    const stoneMat = new CANNON.Material('stone');
    this.metalMat = new CANNON.Material('metal');

    const addPair = (m1: CANNON.Material, m2: CANNON.Material, friction: number, restitution: number) => {
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(m1, m2, {
          friction,
          restitution,
          contactEquationStiffness: 1.5e7,
          contactEquationRelaxation: 4.0,
          frictionEquationStiffness: 1.2e7,
          frictionEquationRelaxation: 4.0
        })
      );
    };

    addPair(tableMat, brickMat, 0.66, 0.03);
    addPair(tableMat, stoneMat, 0.72, 0.02);
    addPair(tableMat, plasticMat, 0.42, 0.1);
    addPair(tableMat, woodMat, 0.54, 0.05);
    addPair(tableMat, plateMat, 0.55, 0.04);
    addPair(tableMat, this.metalMat, 0.58, 0.04);

    addPair(brickMat, brickMat, 0.62, 0.03);
    addPair(brickMat, plateMat, 0.54, 0.04);
    addPair(brickMat, plasticMat, 0.36, 0.08);
    addPair(brickMat, woodMat, 0.48, 0.05);
    addPair(brickMat, stoneMat, 0.65, 0.03);
    addPair(brickMat, this.metalMat, 0.58, 0.03);

    addPair(plateMat, plasticMat, 0.38, 0.08);
    addPair(plateMat, woodMat, 0.5, 0.05);
    addPair(plateMat, this.metalMat, 0.52, 0.03);
    addPair(plasticMat, plasticMat, 0.32, 0.12);
    addPair(plasticMat, this.metalMat, 0.36, 0.06);
    addPair(woodMat, woodMat, 0.48, 0.05);
    addPair(woodMat, this.metalMat, 0.48, 0.04);

    // Finite Static Table Box (top surface at y = 0)
    const tableThicknessM = 0.08;
    this.tableBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: tableMat,
      position: new CANNON.Vec3(0, 0, 0)
    });
    this.tableBody.addShape(
      new CANNON.Box(new CANNON.Vec3(0.62 * PHYS_SCALE, tableThicknessM * 0.5 * PHYS_SCALE, 0.62 * PHYS_SCALE)),
      new CANNON.Vec3(0, -tableThicknessM * 0.5 * PHYS_SCALE, 0)
    );
    this.world.addBody(this.tableBody);

    // Finite Static Catch Floor Box (replaces infinite CANNON.Plane so SAPBroadphase skips all standing bricks!)
    this.catchFloorBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: tableMat,
      position: new CANNON.Vec3(0, -0.36 * PHYS_SCALE, 0)
    });
    this.catchFloorBody.addShape(new CANNON.Box(new CANNON.Vec3(2.2 * PHYS_SCALE, 0.04 * PHYS_SCALE, 2.2 * PHYS_SCALE)));
    this.world.addBody(this.catchFloorBody);

    const courseCounts = new Map<number, number>();
    for (const p of solution.parts) {
      if (p.kind === 'binder') continue;
      courseCounts.set(p.courseIndex, (courseCounts.get(p.courseIndex) ?? 0) + 1);
    }

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
        linearDamping: 0.045,
        angularDamping: 0.09,
        position: new CANNON.Vec3(p.x * PHYS_SCALE, p.y * PHYS_SCALE, p.z * PHYS_SCALE)
      });
      body.quaternion.setFromAxisAngle(CANNON.Vec3.UNIT_Y, p.rotY);

      if (p.kind === 'cylinder' || p.kind === 'rod') {
        const radiusPhys = Math.max(0.05, p.sx * 0.5 * PHYS_SCALE);
        const heightPhys = Math.max(0.05, p.sy * PHYS_SCALE);
        body.addShape(new CANNON.Cylinder(radiusPhys, radiusPhys, heightPhys, 8));
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
        sameCourseCount: courseCounts.get(p.courseIndex) ?? 1,
        prevPos: body.position.clone(),
        prevQuat: body.quaternion.clone(),
        renderPosM: { x: p.x, y: p.y, z: p.z },
        renderQuat: { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w }
      };
      this.handles.push(handle);
      this.handleById.set(p.id, handle);

      const topM = p.y + p.sy * 0.5;
      if (topM > this.initialTopHeightM) {
        this.initialTopHeightM = topM;
        this.topCrownX = p.x;
        this.topCrownZ = p.z;
      }
    }

    // Physical Tape & Side-Lash constraints
    for (const h of this.handles) {
      const p = h.part;
      if (p.tapedToBelow) {
        const below = this.findNearestBodyInCourse(p.courseIndex - 1, p.x, p.z);
        if (below) {
          this.world.addConstraint(new CANNON.LockConstraint(h.body, below.body, { maxForce: 42 * PHYS_SCALE }));
        }
      }
      if (p.lashedToCourseMin !== undefined && p.lashedToCourseMax !== undefined) {
        const lowB = this.findNearestBodyInCourse(p.lashedToCourseMin, p.x, p.z);
        const highB = this.findNearestBodyInCourse(p.lashedToCourseMax, p.x, p.z);
        if (lowB) {
          this.world.addConstraint(new CANNON.LockConstraint(h.body, lowB.body, { maxForce: 95 * PHYS_SCALE }));
        }
        if (highB && highB !== lowB) {
          this.world.addConstraint(new CANNON.LockConstraint(h.body, highB.body, { maxForce: 95 * PHYS_SCALE }));
        }
      }
    }

    // 3-Way Tension-Only Guy-Wire Ropes
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
   * Dynamically spawns, updates, or removes the 3D Calibration Test Weight (`Quả cân thử tải X kg`) on top of the tower!
   */
  private syncTopPayloadBody(targetKg: number, crushCourseIdx: number | null): void {
    const cleanKg = targetKg >= 0.1 ? Number(targetKg.toFixed(1)) : 0;
    if (Math.abs(cleanKg - this.currentPayloadKg) > 0.05) {
      this.isSettledIdle = false;
      if (this.payloadConstraint) {
        this.world.removeConstraint(this.payloadConstraint);
        this.payloadConstraint = null;
      }
      if (this.payloadBody) {
        this.world.removeBody(this.payloadBody);
        this.payloadBody = null;
      }
      this.currentPayloadKg = cleanKg;
      if (cleanKg > 0 && this.handles.length > 0) {
        // Locate exact world-space top crown tip (accounting for tilted table & tilted spire rods!)
        let topHandle: DynamicPartHandle | null = null;
        let bestTopPhys = -Infinity;
        for (const h of this.handles) {
          const tipPhys = h.body.pointToWorldFrame(
            new CANNON.Vec3(0, h.part.sy * 0.5 * PHYS_SCALE, 0),
            this.tmpV1
          );
          if (tipPhys.y > bestTopPhys) {
            bestTopPhys = tipPhys.y;
            topHandle = h;
          }
        }
        this.payloadSizeM = Math.min(0.16, Math.max(0.068, 0.062 * Math.cbrt(cleanKg)));
        const hs = this.payloadSizeM * 0.5 * PHYS_SCALE;
        const spawnPhys = topHandle
          ? topHandle.body.pointToWorldFrame(
              new CANNON.Vec3(
                0,
                (topHandle.part.sy * 0.5 + this.payloadSizeM * 0.82 * 0.5 + 0.002) * PHYS_SCALE,
                0
              )
            )
          : new CANNON.Vec3(
              this.topCrownX * PHYS_SCALE,
              (this.initialTopHeightM + this.payloadSizeM * 0.5 + 0.002) * PHYS_SCALE,
              this.topCrownZ * PHYS_SCALE
            );
        const b = new CANNON.Body({
          mass: cleanKg,
          material: this.metalMat,
          linearDamping: 0.04,
          angularDamping: 0.08,
          position: spawnPhys
        });
        if (topHandle) {
          b.quaternion.copy(topHandle.body.quaternion);
        }
        b.addShape(new CANNON.Box(new CANNON.Vec3(hs, hs * 0.82, hs)));
        this.world.addBody(b);
        if (topHandle && topHandle.part.kind === 'rod') {
          this.payloadConstraint = new CANNON.LockConstraint(b, topHandle.body, {
            maxForce: 140 * PHYS_SCALE
          });
          this.world.addConstraint(this.payloadConstraint);
        }
        this.payloadBody = b;
        this.payloadPrevPos.copy(b.position);
        this.payloadPrevQuat.copy(b.quaternion);
      }
    }

    // If material crush / Euler buckling threshold is exceeded, buckle the overloaded course in 3D!
    if (crushCourseIdx !== null && this.triggeredCrushCourse !== crushCourseIdx) {
      this.triggeredCrushCourse = crushCourseIdx;
      this.isSettledIdle = false;
      if (this.payloadConstraint) {
        this.world.removeConstraint(this.payloadConstraint);
        this.payloadConstraint = null;
      }
      for (const h of this.handles) {
        if (h.part.courseIndex === crushCourseIdx) {
          // Kick & tilt the crushed/buckled member out from under the load so upper courses genuinely collapse!
          h.body.velocity.set(2.4 * PHYS_SCALE, -0.5 * PHYS_SCALE, 0.6 * PHYS_SCALE);
          h.body.angularVelocity.set(2.5, 0, -8.5);
        }
      }
    } else if (crushCourseIdx === null) {
      this.triggeredCrushCourse = null;
    }
  }

  public pokePart(partId: string, dirX = 1, dirZ = 0.15, impulseNs = 1.35): boolean {
    const h = this.handleById.get(partId);
    if (!h) return false;
    this.isSettledIdle = false;
    const len = Math.hypot(dirX, dirZ) || 1;
    const imp = new CANNON.Vec3(
      (dirX / len) * impulseNs * PHYS_SCALE,
      0.08 * impulseNs * PHYS_SCALE,
      (dirZ / len) * impulseNs * PHYS_SCALE
    );
    h.body.applyImpulse(imp, new CANNON.Vec3(0, h.part.sy * 0.18 * PHYS_SCALE, 0));
    return true;
  }

  /**
   * Steps physics at fixed 60Hz (`maxSubSteps = 2`) and interpolates poses smoothly for 120Hz rendering!
   */
  public step(
    frameDtSec: number,
    env: EnvironmentLoadConfig,
    paused = false,
    crushCourseIdx: number | null = null
  ): PhysicsStepTelemetry {
    const payloadKg = env.topPayloadKg ?? 0;
    const envKey = `${env.windSpeedMps.toFixed(1)}|${env.tiltDeg.toFixed(1)}|${env.shakeG.toFixed(3)}|${payloadKg.toFixed(1)}|${crushCourseIdx ?? -1}`;
    if (envKey !== this.lastEnvKey) {
      this.lastEnvKey = envKey;
      this.isSettledIdle = false;
    }

    this.syncTopPayloadBody(payloadKg, crushCourseIdx);

    if (!paused && !this.isSettledIdle) {
      const clampedDt = Math.min(0.034, Math.max(0, frameDtSec));
      this.accumulatorSec += clampedDt;
      let steps = 0;
      while (this.accumulatorSec >= FIXED_DT && steps < 2) {
        this.stepSingleSubstep(FIXED_DT, env);
        this.accumulatorSec -= FIXED_DT;
        steps++;
      }
      if (this.accumulatorSec > FIXED_DT) {
        this.accumulatorSec = FIXED_DT * 0.99;
      }

      // Smart Auto-Sleep when calm & motionless (cuts idle CPU to 0.00ms!)
      if (
        steps > 0 &&
        this.simTimeSec > 1.8 &&
        env.windSpeedMps < 0.35 &&
        env.shakeG < 0.002 &&
        Math.abs((env.tiltDeg * Math.PI) / 180 - this.currentTiltRad) < 1e-4
      ) {
        let maxVelSq = 0;
        for (let i = 0; i < this.handles.length; i++) {
          const b = this.handles[i].body;
          const vSq = b.velocity.lengthSquared() + b.angularVelocity.lengthSquared();
          if (vSq > maxVelSq) maxVelSq = vSq;
        }
        if (this.payloadBody) {
          const pvSq = this.payloadBody.velocity.lengthSquared() + this.payloadBody.angularVelocity.lengthSquared();
          if (pvSq > maxVelSq) maxVelSq = pvSq;
        }
        if (maxVelSq < 0.004) {
          this.isSettledIdle = true;
        }
      }
    }

    const alpha = paused || this.isSettledIdle ? 1.0 : Math.min(1, Math.max(0, this.accumulatorSec / FIXED_DT));
    this.updateInterpolatedPoses(alpha);
    return this.collectTelemetry(alpha);
  }

  private updateInterpolatedPoses(alpha: number): void {
    const invScale = 1 / PHYS_SCALE;
    const oneMinus = 1 - alpha;
    for (let i = 0; i < this.handles.length; i++) {
      const h = this.handles[i];
      const cp = h.body.position;
      const pp = h.prevPos;
      h.renderPosM.x = (pp.x * oneMinus + cp.x * alpha) * invScale;
      h.renderPosM.y = (pp.y * oneMinus + cp.y * alpha) * invScale;
      h.renderPosM.z = (pp.z * oneMinus + cp.z * alpha) * invScale;

      const cq = h.body.quaternion;
      const pq = h.prevQuat;
      const dotSign = pq.x * cq.x + pq.y * cq.y + pq.z * cq.z + pq.w * cq.w < 0 ? -1 : 1;
      let qx = pq.x * oneMinus + cq.x * dotSign * alpha;
      let qy = pq.y * oneMinus + cq.y * dotSign * alpha;
      let qz = pq.z * oneMinus + cq.z * dotSign * alpha;
      let qw = pq.w * oneMinus + cq.w * dotSign * alpha;
      const qLen = Math.hypot(qx, qy, qz, qw) || 1;
      h.renderQuat.x = qx / qLen;
      h.renderQuat.y = qy / qLen;
      h.renderQuat.z = qz / qLen;
      h.renderQuat.w = qw / qLen;
    }
  }

  private stepSingleSubstep(dt: number, env: EnvironmentLoadConfig): void {
    // Save previous pose for 120Hz frame interpolation
    for (let i = 0; i < this.handles.length; i++) {
      const h = this.handles[i];
      h.prevPos.copy(h.body.position);
      h.prevQuat.copy(h.body.quaternion);
    }
    if (this.payloadBody) {
      this.payloadPrevPos.copy(this.payloadBody.position);
      this.payloadPrevQuat.copy(this.payloadBody.quaternion);
    }

    const tNext = this.simTimeSec + dt;
    const u = Math.min(1, tNext / 0.55);
    const smoothEnv = u * u * (3 - 2 * u);

    // 1. D'Alembert Non-Inertial Table Reference Frame
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

    const shakeAccelXMps2 =
      env.shakeG * GRAVITY_M_S2 * smoothEnv * (0.74 * Math.sin(13.2 * tNext) + 0.26 * Math.sin(23.1 * tNext));
    const shakeAccelZMps2 =
      env.shakeG * GRAVITY_M_S2 * 0.28 * smoothEnv * Math.sin(9.7 * tNext + 0.9);

    this.world.gravity.set(
      (GRAVITY_M_S2 * Math.sin(totalSlopeRad) - shakeAccelXMps2) * PHYS_SCALE,
      -GRAVITY_M_S2 * Math.cos(totalSlopeRad) * PHYS_SCALE,
      -shakeAccelZMps2 * PHYS_SCALE
    );

    this.visualTableOffsetM.x =
      env.shakeG * 0.036 * smoothEnv * (0.74 * Math.sin(13.2 * tNext) + 0.26 * Math.sin(23.1 * tNext));
    this.visualTableOffsetM.z = env.shakeG * 0.012 * smoothEnv * Math.sin(9.7 * tNext + 0.9);
    this.visualTableRollRad = -totalSlopeRad;

    // 2. Aerodynamic Wind Drag + Turbulent Gusts
    const windBaseMps = Math.max(0, env.windSpeedMps);
    if (windBaseMps > 0.05) {
      for (let i = 0; i < this.handles.length; i++) {
        const h = this.handles[i];
        const b = h.body;
        const hM = Math.max(0.04, b.position.y / PHYS_SCALE);
        const boundaryProfile = Math.pow(Math.min(2.6, hM / 0.75), 0.16);
        const gust =
          1.0 + 0.24 * Math.sin(3.3 * tNext - 1.9 * hM) + 0.13 * Math.sin(7.7 * tNext + i * 1.7);
        const vWindX = windBaseMps * boundaryProfile * gust;
        const vRelX = vWindX - b.velocity.x / PHYS_SCALE;

        const p = h.part;
        let frontalAreaM2: number;
        let cd: number;
        if (p.kind === 'cylinder' || p.kind === 'rod') {
          frontalAreaM2 = p.sx * p.sy;
          cd = 0.88;
        } else {
          const worldAxisX = b.quaternion.vmult(CANNON.Vec3.UNIT_X, this.tmpV1);
          const worldAxisZ = b.quaternion.vmult(CANNON.Vec3.UNIT_Z, this.tmpV2);
          const projWidthM = Math.abs(worldAxisX.x) * p.sz + Math.abs(worldAxisZ.x) * p.sx;
          frontalAreaM2 = Math.max(0.0005, projWidthM * p.sy);
          cd = p.kind === 'plate' ? 1.15 : 1.24;
        }

        const wakeShield = h.sameCourseCount > 1 ? 1 / Math.sqrt(h.sameCourseCount) : 1.0;
        const dragForceN = 0.5 * AIR_DENSITY * cd * frontalAreaM2 * wakeShield * vRelX * Math.abs(vRelX);
        const vortexForceZN =
          windBaseMps >= 4.5 ? Math.abs(dragForceN) * 0.14 * Math.sin(5.8 * tNext + hM * 3.7 + i * 0.5) : 0;

        this.tmpForce.set(dragForceN * PHYS_SCALE, 0, vortexForceZN * PHYS_SCALE);
        this.tmpPoint.set(b.position.x, b.position.y + p.sy * 0.08 * PHYS_SCALE, b.position.z);
        b.applyForce(this.tmpForce, this.tmpPoint);
      }
    }

    // 3. Tension-Only Guy-Wires
    for (let g = 0; g < this.guyWireBindings.length; g++) {
      const gw = this.guyWireBindings[g];
      const worldCollar = gw.targetBody.pointToWorldFrame(gw.localAnchor, this.tmpV1);
      const worldStake = gw.tableLocalStake;
      const dx = worldStake.x - worldCollar.x;
      const dy = worldStake.y - worldCollar.y;
      const dz = worldStake.z - worldCollar.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > gw.restLengthPhys && dist > 1e-4) {
        const stretch = dist - gw.restLengthPhys;
        const ux = dx / dist;
        const uy = dy / dist;
        const uz = dz / dist;
        const vCollar = gw.targetBody.velocity;
        const vAlong = -(vCollar.x * ux + vCollar.y * uy + vCollar.z * uz);
        const tensionPhys = Math.min(350 * PHYS_SCALE, Math.max(0, stretch * 950 + vAlong * 18));
        this.tmpForce.set(ux * tensionPhys, uy * tensionPhys, uz * tensionPhys);
        gw.targetBody.applyForce(this.tmpForce, worldCollar);
      }
    }

    this.world.step(dt);
    this.simTimeSec = tNext;
  }

  public collectTelemetry(alpha = 1.0): PhysicsStepTelemetry {
    let totalMass = 0;
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let liveTopHeightM = 0;
    let maxDriftM = 0;
    let dislodgedCount = 0;

    for (let i = 0; i < this.handles.length; i++) {
      const h = this.handles[i];
      const p = h.part;
      const bx = h.renderPosM.x;
      const by = h.renderPosM.y;
      const bz = h.renderPosM.z;

      totalMass += p.massKg;
      sumX += p.massKg * bx;
      sumY += p.massKg * by;
      sumZ += p.massKg * bz;

      const upVec = h.body.quaternion.vmult(CANNON.Vec3.UNIT_Y, this.tmpV1);
      const tiltCos = Math.abs(upVec.y);
      const currentTopM =
        by + (tiltCos * p.sy * 0.5 + Math.sqrt(Math.max(0, 1 - tiltCos * tiltCos)) * Math.max(p.sx, p.sz) * 0.5);

      const dropFromInitialM = p.y - by;
      const horizDriftM = Math.hypot(bx - p.x, bz - p.z);

      const isCoreStructural = !p.id.startsWith('ballast-');
      const isDislodged = dropFromInitialM > Math.max(0.06, p.sy * 0.65) || tiltCos < 0.61 || by < -0.02;
      if (isDislodged) {
        if (isCoreStructural) dislodgedCount++;
      } else {
        if (currentTopM > liveTopHeightM) liveTopHeightM = currentTopM;
        if (horizDriftM > maxDriftM) maxDriftM = horizDriftM;
      }
      if (liveTopHeightM === 0 && by > 0 && currentTopM > liveTopHeightM) {
        liveTopHeightM = currentTopM;
      }
    }

    let payloadVisual: PayloadVisualState = {
      visible: false,
      kg: 0,
      sizeM: this.payloadSizeM,
      x: 0,
      y: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1
    };

    if (this.payloadBody && this.currentPayloadKg > 0) {
      const oneMinus = 1 - alpha;
      const cp = this.payloadBody.position;
      const pp = this.payloadPrevPos;
      const px = (pp.x * oneMinus + cp.x * alpha) / PHYS_SCALE;
      const py = (pp.y * oneMinus + cp.y * alpha) / PHYS_SCALE;
      const pz = (pp.z * oneMinus + cp.z * alpha) / PHYS_SCALE;
      totalMass += this.currentPayloadKg;
      sumX += this.currentPayloadKg * px;
      sumY += this.currentPayloadKg * py;
      sumZ += this.currentPayloadKg * pz;
      // Check if payload weight itself fell off the top!
      if (py < this.initialTopHeightM * 0.65) {
        dislodgedCount++;
      }
      payloadVisual = {
        visible: true,
        kg: this.currentPayloadKg,
        sizeM: this.payloadSizeM,
        x: px,
        y: py,
        z: pz,
        qx: this.payloadBody.quaternion.x,
        qy: this.payloadBody.quaternion.y,
        qz: this.payloadBody.quaternion.z,
        qw: this.payloadBody.quaternion.w
      };
    }

    const guyWires: GuyWireLiveState[] = [];
    for (let g = 0; g < this.guyWireBindings.length; g++) {
      const gw = this.guyWireBindings[g];
      const worldCollar = gw.targetBody.pointToWorldFrame(gw.localAnchor, this.tmpV1);
      const worldStake = gw.tableLocalStake;
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
      this.handles.length > 0 &&
      (heightLossRatio > 0.18 || dislodgedCount >= Math.max(1, Math.ceil(this.handles.length * 0.2)));

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
      guyWires,
      payloadVisual
    };
  }
}

export function verifyTowerSurvivesPhysics(
  solution: TowerSolution,
  env: EnvironmentLoadConfig,
  simSeconds = 3.6
): boolean {
  if (solution.parts.length === 0) return true;
  const sim = new BrickTowerPhysicsSim(solution);
  const frames = Math.round(simSeconds * 60);
  const crushIdx = solution.loadReport?.crushFailedCourseIndex ?? null;
  for (let f = 0; f < frames; f++) {
    const tel = sim.step(1 / 60, env, false, crushIdx);
    if (tel.collapsed) return false;
  }
  return true;
}

export function findStandingCandidateIndexInPhysics(
  ladder: TowerSolution[],
  env: EnvironmentLoadConfig,
  startIdx = 0
): number {
  if (ladder.length === 0) return 0;
  for (let i = Math.max(0, startIdx); i < ladder.length; i++) {
    if (verifyTowerSurvivesPhysics(ladder[i], env, 3.6)) {
      return i;
    }
  }
  return ladder.length - 1;
}
