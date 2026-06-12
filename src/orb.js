import {
    Entity,
    StandardMaterial,
    Texture,
    Color,
    Vec3,
    BLEND_ADDITIVE,
    CULLFACE_NONE,
    PIXELFORMAT_RGBA8,
    FILTER_LINEAR_MIPMAP_LINEAR,
    FILTER_LINEAR,
    ADDRESS_CLAMP_TO_EDGE
} from 'playcanvas';

/**
 * Creates a soft radial gradient texture used by the halo billboard.
 */
function createHaloTexture(device) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    const texture = new Texture(device, {
        width: size,
        height: size,
        format: PIXELFORMAT_RGBA8,
        mipmaps: true,
        minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: FILTER_LINEAR,
        addressU: ADDRESS_CLAMP_TO_EDGE,
        addressV: ADDRESS_CLAMP_TO_EDGE
    });
    texture.setSource(canvas);
    return texture;
}

/**
 * The glowing location orb: an emissive core sphere (writes depth, so splats
 * in front of it cover it and it covers splats behind it) plus an additive
 * halo billboard for the visible glow.
 */
export class Orb {
    constructor(app) {
        this.app = app;
        this.target = new Vec3();
        this._color = new Color(0.25, 0.65, 1.0);

        this.entity = new Entity('orb');

        // emissive core - opaque, writes depth
        this.coreMaterial = new StandardMaterial();
        this.coreMaterial.useLighting = false;
        this.coreMaterial.diffuse = new Color(0, 0, 0);
        this.coreMaterial.emissive = this._color;
        this.coreMaterial.emissiveIntensity = 2;
        this.coreMaterial.update();

        this.core = new Entity('orb-core');
        this.core.addComponent('render', { type: 'sphere' });
        this.core.render.meshInstances.forEach(mi => (mi.material = this.coreMaterial));
        this.entity.addChild(this.core);

        // additive halo billboard - no depth write, depth-tested
        this.haloMaterial = new StandardMaterial();
        this.haloMaterial.useLighting = false;
        this.haloMaterial.diffuse = new Color(0, 0, 0);
        this.haloMaterial.emissive = this._color;
        this.haloMaterial.emissiveMap = createHaloTexture(app.graphicsDevice);
        this.haloMaterial.blendType = BLEND_ADDITIVE;
        this.haloMaterial.depthWrite = false;
        this.haloMaterial.cull = CULLFACE_NONE;
        this.haloMaterial.update();

        this.halo = new Entity('orb-halo');
        this.halo.addComponent('render', { type: 'plane' });
        this.halo.render.meshInstances.forEach((mi) => {
            mi.material = this.haloMaterial;
            // keep the additive halo from being distance-culled oddly
            mi.castShadow = false;
        });
        this.entity.addChild(this.halo);

        app.root.addChild(this.entity);
        this.applyParams({
            size: 0.12, coreBrightness: 2, haloSize: 0.9, haloOpacity: 0.8,
            color: { r: 0.25, g: 0.65, b: 1.0 }
        });
    }

    /** Snap the orb (and its smoothed target) to a position. */
    teleport(pos) {
        this.target.copy(pos);
        this.entity.setPosition(pos);
    }

    /** Set the smoothed movement target. */
    setTarget(pos) {
        this.target.copy(pos);
    }

    applyParams(orbParams) {
        const { r, g, b } = orbParams.color;
        this._color.set(r, g, b);
        this.coreMaterial.emissive = this._color;
        this.coreMaterial.emissiveIntensity = orbParams.coreBrightness;
        this.coreMaterial.update();

        this.haloMaterial.emissive = new Color(
            r * orbParams.haloOpacity,
            g * orbParams.haloOpacity,
            b * orbParams.haloOpacity
        );
        this.haloMaterial.update();

        this.core.setLocalScale(orbParams.size * 2, orbParams.size * 2, orbParams.size * 2);
        this.halo.setLocalScale(orbParams.haloSize, orbParams.haloSize, orbParams.haloSize);
    }

    /** Per-frame: smooth movement + billboard the halo toward the camera. */
    update(dt, cameraEntity, smoothing) {
        const pos = this.entity.getPosition();
        const t = 1 - Math.exp(-smoothing * dt);
        const nx = pos.x + (this.target.x - pos.x) * t;
        const ny = pos.y + (this.target.y - pos.y) * t;
        const nz = pos.z + (this.target.z - pos.z) * t;
        this.entity.setPosition(nx, ny, nz);

        // screen-aligned billboard: copy camera rotation, then tip the plane
        // (which faces +Y) toward the viewer
        this.halo.setRotation(cameraEntity.getRotation());
        this.halo.rotateLocal(90, 0, 0);
    }

    getPosition() {
        return this.entity.getPosition();
    }
}
