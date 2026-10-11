import * as THREE from 'three';
import { TUNING } from './tuning';

const BODY_RADII = new THREE.Vector3(0.35, 0.315, 0.56);
const WING_SPAN = 1.3;
const WING_CHORD = 0.3; // half-width of the wing at its root

export class Bird {
  readonly root = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  heading = 0; // yaw in radians; 0 flies towards -z
  private yawRate = 0;
  private readonly body: THREE.Mesh;
  private readonly tail: THREE.Mesh;
  private readonly wings: THREE.Mesh[];
  private elapsed = 0;

  constructor() {
    this.root.rotation.order = 'YXZ'; // yaw, then roll about the bird's own axis
    this.body = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16).scale(BODY_RADII.x, BODY_RADII.y, BODY_RADII.z),
      new THREE.MeshStandardMaterial({ color: 0x3fb8ff, emissive: 0x1a4dff, emissiveIntensity: 0.2 }),
    );
    // The cone's wide end faces backwards, so from behind the tail reads as a fan.
    this.tail = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.7, 12).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xff5fc8, emissive: 0xff2fa0, emissiveIntensity: 0.3 }),
    );
    this.tail.position.z = 0.75;
    this.root.add(this.body, this.tail);

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(0.6, 0.35, WING_SPAN, 0.1);
    shape.quadraticCurveTo(0.7, -0.25, 0, -WING_CHORD);
    const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffd36e,
      emissive: 0xff9a2f,
      emissiveIntensity: 0.25,
      side: THREE.DoubleSide,
    });
    this.wings = [1, -1].map((side) => {
      const wing = new THREE.Mesh(geometry, material);
      wing.scale.x = side;
      wing.position.x = side * 0.2;
      this.root.add(wing);
      return wing;
    });
    this.root.position.y = TUNING.flight.baseHeight;
  }

  /** steer.x in [-1, 1] turns (right is positive); steer.y in [-1, 1] climbs. */
  update(dt: number, steer: THREE.Vector2): void {
    const f = TUNING.flight;
    this.elapsed += dt;
    const ease = 1 - Math.exp(-f.steerEase * dt);
    this.yawRate += (-steer.x * f.maxYawRate - this.yawRate) * ease;
    this.heading += this.yawRate * dt;

    const p = this.root.position;
    const targetY = f.baseHeight + steer.y * f.heightRange;
    const prevY = p.y;
    p.y += (targetY - p.y) * ease;
    this.velocity.set(-Math.sin(this.heading) * f.speed, (p.y - prevY) / dt, -Math.cos(this.heading) * f.speed);
    p.x += this.velocity.x * dt;
    p.z += this.velocity.z * dt;

    this.root.rotation.set(0, this.heading, this.yawRate * f.bankPerYawRate);
    const flap = Math.sin(this.elapsed * Math.PI * 2 * f.flapHz) * f.flapAmplitude;
    this.wings[0].rotation.z = flap;
    this.wings[1].rotation.z = -flap;
    this.root.updateMatrixWorld(true);
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  /** A random point on the bird's surface in world space, weighted towards the wings. */
  randomSurfacePoint(out: THREE.Vector3): THREE.Vector3 {
    const r = Math.random();
    if (r < 0.6) {
      const wing = this.wings[r < 0.3 ? 0 : 1];
      const u = Math.random();
      const chord = (Math.random() - 0.5) * 2 * WING_CHORD * (1 - u * 0.8);
      return out.set(u * WING_SPAN, 0, -chord).applyMatrix4(wing.matrixWorld);
    }
    if (r < 0.88) {
      out.randomDirection().multiply(BODY_RADII);
      return out.applyMatrix4(this.body.matrixWorld);
    }
    out.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.6);
    return out.applyMatrix4(this.tail.matrixWorld);
  }
}
