import { Vec3, math } from 'playcanvas';

const tmpV1 = new Vec3();

const MIN_RADIUS = 0.6;   // never let the camera get closer than this (m)

/** Horizontal (XZ) distance between two points, ignoring height. */
const horizDist = (a, b) => {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
};

/**
 * Automatic cinematic camera that follows the orb. It views the orb from
 * slightly above (looking down at an angle) at a standoff distance. As the orb
 * wanders it holds its angle and just follows; if the orb crowds the camera it
 * orbits around to re-open the gap. Crucially the orbit radius is shortened on
 * the fly so the camera always stays inside the room, and when the orb pushes
 * the camera toward a wall the camera pivots around the orb to face it from the
 * open (interior) side instead of being shoved through the wall.
 */
export class CinematicCamera {
    /**
     * @param {*} cameraEntity - camera entity (driven directly while active)
     * @param {*} controls - CameraControls script instance (suspended while active)
     * @param {*} orb - Orb instance
     * @param {*} roomBounds - { center: Vec3, halfExtents: Vec3 } world-space room bounds
     * @param {*} params - global params object
     */
    constructor(cameraEntity, controls, orb, roomBounds, params) {
        this.camera = cameraEntity;
        this.controls = controls;
        this.orb = orb;
        this.roomBounds = roomBounds;
        this.params = params;

        this.active = false;
        this._camPos = new Vec3();
        this._lookTarget = new Vec3();
        this._azimuth = 0;     // angle (rad) of the camera around the orb
        this._orbitDir = 1;    // current orbit direction (+1 / -1)
        this._pivoting = false; // mid swing to the orb's far (interior) side
        this._lastDesired = new Vec3(); // previous frame's target position
    }

    /** Azimuth pointing from the orb toward the room center (most-interior side). */
    _interiorAzimuth(orbPos) {
        const c = this.roomBounds.center;
        const dx = c.x - orbPos.x;
        const dz = c.z - orbPos.z;
        if (dx * dx + dz * dz < 1e-6) return this._azimuth;
        return Math.atan2(dz, dx);
    }

    /** Step `from` toward `to` (radians) by at most `maxStep`, via the shorter arc. */
    _rotateToward(from, to, maxStep) {
        let diff = (to - from) % (2 * Math.PI);
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
        if (Math.abs(diff) <= maxStep) return to;
        return from + Math.sign(diff) * maxStep;
    }

    /**
     * Distance from the orb to the (inset) room wall along a horizontal
     * direction — i.e. the largest radius that keeps the camera inside.
     */
    _maxRadiusAlong(orbPos, dirX, dirZ) {
        const { center, halfExtents } = this.roomBounds;
        const margin = 0.3;
        const xmin = center.x - halfExtents.x + margin;
        const xmax = center.x + halfExtents.x - margin;
        const zmin = center.z - halfExtents.z + margin;
        const zmax = center.z + halfExtents.z - margin;
        let t = Infinity;
        if (dirX > 1e-6) t = Math.min(t, (xmax - orbPos.x) / dirX);
        else if (dirX < -1e-6) t = Math.min(t, (xmin - orbPos.x) / dirX);
        if (dirZ > 1e-6) t = Math.min(t, (zmax - orbPos.z) / dirZ);
        else if (dirZ < -1e-6) t = Math.min(t, (zmin - orbPos.z) / dirZ);
        return Math.max(t, 0);
    }

    /** Clamp Y to the room (safety net for the vertical axis). */
    _clampY(pos) {
        const { center, halfExtents } = this.roomBounds;
        const floorY = this.params.source.floorY;
        pos.y = math.clamp(pos.y, floorY + 0.3, center.y + halfExtents.y - 0.3);
        return pos;
    }

    /** Begin cinematic control: capture current pose and suspend manual input. */
    start() {
        if (this.active) return;
        this.active = true;

        this._camPos.copy(this.camera.getPosition());
        const orbPos = this.orb.getPosition();
        this._lookTarget.copy(orbPos);
        this._pivoting = false;
        // start orbiting from wherever the camera currently sits
        this._azimuth = Math.atan2(this._camPos.z - orbPos.z, this._camPos.x - orbPos.x);

        this.controls.enabled = false;
    }

    /** End cinematic control: re-sync manual controls to the current pose. */
    stop() {
        if (!this.active) return;
        this.active = false;

        const position = this.camera.getPosition();
        this.controls.reset(this._lookTarget.clone(), position.clone());
        this.controls.enabled = true;
    }

    /**
     * @param {number} dt - The time delta.
     */
    update(dt) {
        if (!this.active) return;
        dt = Math.min(dt, 0.1);

        const cfg = this.params.camera.cinematic;
        const orbPos = this.orb.getPosition();

        const elev = cfg.elevation * math.DEG_TO_RAD;
        const rH = cfg.distance * Math.cos(elev);
        const rV = cfg.distance * Math.sin(elev);

        // ease the aim toward the orb (smooth cinematic pan)
        const lookT = 1 - Math.exp(-cfg.lookSmoothing * dt);
        this._lookTarget.lerp(this._lookTarget, orbPos, lookT);

        // how much room there is at the current angle before hitting a wall
        const fitR = Math.min(rH, this._maxRadiusAlong(orbPos, Math.cos(this._azimuth), Math.sin(this._azimuth)));
        const cramped = fitR < rH - 0.05;

        // once the orb pushes us toward a wall, commit to swinging all the way
        // around to the orb's far (interior) side rather than nudging slightly
        if (cramped) {
            this._pivoting = true;
        }

        if (this._pivoting) {
            const interiorAz = this._interiorAzimuth(orbPos);
            this._azimuth = this._rotateToward(this._azimuth, interiorAz, cfg.orbitSpeed * dt);
            // finished once we've reached the interior side
            let diff = (interiorAz - this._azimuth) % (2 * Math.PI);
            if (diff > Math.PI) diff -= 2 * Math.PI;
            if (diff < -Math.PI) diff += 2 * Math.PI;
            if (Math.abs(diff) < 0.02) this._pivoting = false;
        } else {
            // otherwise, if the orb starts to crowd the camera, orbit around it
            // to re-open the gap rather than relocating abruptly. Only react once
            // the camera has settled near its target, so we respond to the orb
            // moving — not to our own catch-up lag after a big swing.
            const settled = this._camPos.distance(this._lastDesired) < 0.15;
            const d = horizDist(this._camPos, orbPos);
            const closeness = math.clamp((cfg.minDistance - d) / Math.max(cfg.minDistance, 0.001), 0, 1);
            if (settled && closeness > 0) {
                const step = cfg.orbitSpeed * closeness * dt;
                // orbit toward whichever side has more room in the room
                const plusR = this._maxRadiusAlong(orbPos, Math.cos(this._azimuth + step), Math.sin(this._azimuth + step));
                const minusR = this._maxRadiusAlong(orbPos, Math.cos(this._azimuth - step), Math.sin(this._azimuth - step));
                this._orbitDir = minusR > plusR ? -1 : 1;
                this._azimuth += this._orbitDir * step;
            }
        }

        // place the camera on the ring around the orb, pulling the radius in as
        // needed so it stays inside the room at the (possibly new) angle
        const dirX = Math.cos(this._azimuth);
        const dirZ = Math.sin(this._azimuth);
        const radius = math.clamp(Math.min(rH, this._maxRadiusAlong(orbPos, dirX, dirZ)), MIN_RADIUS, rH);
        const desired = tmpV1.set(
            orbPos.x + dirX * radius,
            orbPos.y + rV,
            orbPos.z + dirZ * radius
        );
        this._clampY(desired);
        this._lastDesired.copy(desired);

        // glide the camera toward the desired position
        const posT = 1 - Math.exp(-cfg.posSmoothing * dt);
        this._camPos.lerp(this._camPos, desired, posT);

        this.camera.setPosition(this._camPos);
        this.camera.lookAt(this._lookTarget);
    }
}
