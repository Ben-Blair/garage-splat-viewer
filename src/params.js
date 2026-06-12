// Central, observable app state. The settings panel binds to this object and
// the scene reads from it every frame.
export const params = {
    orb: {
        color: { r: 0.25, g: 0.65, b: 1.0 },
        size: 0.12,            // core sphere radius (m)
        coreBrightness: 2.0,   // emissive intensity of the core
        haloSize: 0.9,         // halo billboard diameter (m)
        haloOpacity: 0.8,
        glowIntensity: 1.0,    // how strongly the orb lights up nearby splats
        glowRadius: 1.2,       // falloff radius of splat glow (m)
        height: 0.9,           // height above the floor (m)
        smoothing: 6.0         // position smoothing rate (higher = snappier)
    },
    camera: {
        orbitOrb: false,       // when true the orb is the orbit pivot
        moveSpeed: 2.5,
        moveFastSpeed: 7,
        rotateSpeed: 0.25,
        renderScale: 1.5       // canvas pixel ratio cap (lower = faster)
    },
    cutaway: {
        mode: 'auto',          // 'off' | 'on' | 'auto'
        distance: 2.5,         // keep this much space around the focus point (m)
        softness: 1.2          // fade band width (m)
    },
    occluder: {
        enabled: false         // depth-only collision mesh for crisp occlusion
    },
    source: {
        mode: 'click',         // 'click' | 'demo' | 'sensor'
        keyboardSpeed: 2.5,    // arrow-key orb movement (m/s)
        demoSpeed: 0.25,
        floorY: 0,             // world-space floor height, derived from splat bounds
        sensor: {
            url: 'ws://localhost:8081',
            // sensor-space (mm) -> world-space calibration
            originX: 0,
            originZ: 0,
            rotationDeg: 0,
            scale: 0.001       // mm -> m
        }
    }
};
