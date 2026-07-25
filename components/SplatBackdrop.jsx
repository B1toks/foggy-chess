import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { SplatMesh } from '@sparkjsdev/spark';

/**
 * The Gaussian-splat capture of the valley, rendered as the actual world behind
 * the board rather than a painting of one.
 *
 * `public/sumi-e-mountain-valley-*.spz` — SPZ v3, 1.92M splats, shDegree 0 (so
 * view-independent colour, which is both cheaper and correct for a backdrop).
 *
 * This is mounted *in addition to* the painted cylinder, never instead of it:
 * the painting is 434 KB and loads instantly, the splat is 32 MB. Until the
 * splat arrives — or if it fails outright — the scene still has a backdrop.
 * That is the fallback, and it is why this component never throws upward.
 *
 * Load state is mirrored onto `window.__splat` so a headless run can tell
 * "still downloading 32 MB" apart from "failed".
 */

export const SPLAT_URL = '/sumi-e-mountain-valley-6472fa791839e183.spz';

// Splat captures rarely land in the orientation a scene wants, and this one is
// a world we are dropping a chessboard into rather than the other way round.
// Every number here is overridable from the URL so it can be dialled in
// against a live frame instead of guessed — see readSplatTuning.
const DEFAULTS = {
  scale: 12,
  rotX: 180,
  rotY: 0,
  rotZ: 0,
  posX: 0,
  posY: 0,
  posZ: 0,
  opacity: 1,
};

export function readSplatTuning() {
  const out = { ...DEFAULTS };
  if (typeof window === 'undefined') return out;
  const q = new URLSearchParams(window.location.search);
  for (const key of Object.keys(DEFAULTS)) {
    const raw = q.get(`sp${key}`);
    if (raw !== null && raw !== '' && Number.isFinite(Number(raw))) out[key] = Number(raw);
  }
  return out;
}

export default function SplatBackdrop({ onReady }) {
  const gl = useThree((s) => s.gl);
  const [mesh, setMesh] = useState(null);
  const tuning = useMemo(readSplatTuning, []);

  useEffect(() => {
    let cancelled = false;
    let created = null;

    if (typeof window !== 'undefined') {
      window.__splat = { state: 'loading', error: null };
    }

    try {
      created = new SplatMesh({ url: SPLAT_URL });
    } catch (error) {
      // Spark is built against a newer three than this project pins; if the
      // constructor cannot run at all, the painted backdrop simply stays.
      window.__splat = { state: 'error', error: String(error?.message ?? error) };
      console.warn('[splat] could not construct SplatMesh:', error);
      return undefined;
    }

    // Spark exposes a promise that settles once the file is fetched and the
    // splats are uploaded. Older builds call it `initialized`.
    const ready = created.initialized ?? Promise.resolve();
    Promise.resolve(ready)
      .then(() => {
        if (cancelled) return;
        window.__splat = { state: 'ready', error: null, count: created.numSplats ?? null };
        onReady?.();
      })
      .catch((error) => {
        if (cancelled) return;
        window.__splat = { state: 'error', error: String(error?.message ?? error) };
        console.warn('[splat] failed to load:', error);
      });

    if (!cancelled) setMesh(created);

    return () => {
      cancelled = true;
      created?.dispose?.();
    };
  }, [gl, onReady]);

  useEffect(() => {
    if (!mesh) return;
    mesh.scale.setScalar(tuning.scale);
    mesh.rotation.set(
      THREE.MathUtils.degToRad(tuning.rotX),
      THREE.MathUtils.degToRad(tuning.rotY),
      THREE.MathUtils.degToRad(tuning.rotZ),
    );
    mesh.position.set(tuning.posX, tuning.posY, tuning.posZ);
    // Scene fog does not apply to splats, and a capture that reaches the board
    // would otherwise sit in front of the pieces.
    mesh.renderOrder = -2;
  }, [mesh, tuning]);

  if (!mesh) return null;
  return <primitive object={mesh} />;
}
