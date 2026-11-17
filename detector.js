// On-device drinking detection with MediaPipe Tasks (Face Landmarker, Hand Landmarker, Object Detector).
// Video frames never leave the device: the models run in this page (WebAssembly + WebGL).
//
// A sip = a bottle, cup or glass at the owner's mouth, with a hand there too, held for at least 0.6 s.
// Steady drinking counts one more sip every 1.5 s (the same rules as the Mac app).

const VERSION = '1.2.3';
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const MODELS = {
  face: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  object: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite',
};
const DRINKWARE = ['bottle', 'cup', 'wine glass'];

const SIP_HOLD_MS = 600;      // a lift to the mouth must last this long to count
const SIP_REPEAT_MS = 1500;   // steady gulping: one more sip this often
const FACE_MEMORY_MS = 3000;  // the mouth position is remembered while a glass covers the face
const OBJECT_MEMORY_MS = 2500;
const OWNER_TRUST_MS = 8000;  // once verified, the same face box is trusted (the cup hides features)
const OWNER_THRESHOLD = 0.11; // mean relative difference of the face signature

let tasksPromise = null;

async function createAll() {
  const vision = await import(BUNDLE);
  const files = await vision.FilesetResolver.forVisionTasks(WASM);
  const make = async (Cls, opts) => {
    try { return await Cls.createFromOptions(files, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } }); }
    catch { return Cls.createFromOptions(files, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'CPU' } }); }
  };
  const [face, hand, object] = await Promise.all([
    make(vision.FaceLandmarker, { baseOptions: { modelAssetPath: MODELS.face }, runningMode: 'VIDEO', numFaces: 3 }),
    make(vision.HandLandmarker, { baseOptions: { modelAssetPath: MODELS.hand }, runningMode: 'VIDEO', numHands: 2 }),
    make(vision.ObjectDetector, { baseOptions: { modelAssetPath: MODELS.object }, runningMode: 'VIDEO', scoreThreshold: 0.25, maxResults: 6, categoryAllowlist: DRINKWARE }),
  ]);
  return { face, hand, object };
}

/** Loads the three models once (about 16 MB the first time, then cached by the browser). */
export function loadModels() {
  if (!tasksPromise) tasksPromise = createAll().catch(e => { tasksPromise = null; throw e; });
  return tasksPromise;
}

// ---- Owner signature: proportions of the face from its 3D landmarks --------------------------
// Not a face-recognition embedding: a geometry signature (eye, nose, mouth, jaw and brow proportions,
// scaled by the distance between the eyes). Good enough to tell people apart at a desk; not security.
const PAIRS = [[33, 133], [362, 263], [133, 362], [1, 168], [1, 2], [61, 291], [0, 17], [152, 1], [10, 168], [234, 454],
  [98, 327], [172, 397], [70, 105], [300, 334], [105, 334], [61, 152], [291, 152], [33, 61], [263, 291], [168, 152], [10, 152], [234, 1], [454, 1]];

function signature(lm, w, h) {
  const p = i => [lm[i].x * w, lm[i].y * h, lm[i].z * w];
  const d = (a, b) => { const A = p(a), B = p(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
  const base = d(33, 263) || 1;
  return PAIRS.map(([a, b]) => d(a, b) / base);
}

export function signatureDistance(sig, ref) {
  let s = 0;
  for (let i = 0; i < ref.length; i++) s += Math.abs(sig[i] - ref[i]) / (ref[i] || 1);
  return s / ref.length;
}

function frontal(lm) {
  // Nose tip roughly centred between the eyes: the face is looking at the camera.
  const l = lm[33].x, r = lm[263].x, n = lm[1].x;
  const t = (n - Math.min(l, r)) / (Math.abs(r - l) || 1);
  return t > 0.3 && t < 0.7;
}

function faceBox(lm, w, h) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const q of lm) { if (q.x < x0) x0 = q.x; if (q.y < y0) y0 = q.y; if (q.x > x1) x1 = q.x; if (q.y > y1) y1 = q.y; }
  return { x: x0 * w, y: y0 * h, w: (x1 - x0) * w, h: (y1 - y0) * h };
}

const iou = (a, b) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = x * y; return i / (a.w * a.h + b.w * b.h - i || 1);
};

/**
 * Runs detection on a <video>. Callbacks:
 *  onSip(count)         a sip was counted
 *  onStatus(code)       'looking' | 'ready' | 'drinking' | 'stranger' | 'learning' | 'learned'
 *  onFrame(info)        per processed frame, for the overlay drawing
 * owner: { sig:number[] } | null.  learn: true = learn the owner's face first (about 2 s of frames).
 */
export function createSession({ video, owner, learn, ownerCheck = true, onSip, onStatus, onFrame, onLearned }) {
  let running = true, raf = 0, lastTs = -1, frame = 0;
  let faceSeenAt = 0, mouth = null, faceW = 0, ownerBox = null, ownerAt = 0;
  let objectAt = 0, poseSince = 0, lastSipAt = 0, sips = 0, status = '';
  if (!ownerCheck && !learn) owner = null;
  let learning = !!learn || (ownerCheck && !owner), samples = [];
  const set = s => { if (s !== status) { status = s; onStatus?.(s); } };
  set(learning ? 'learning' : 'looking');

  loadModels().then(tasks => {
    const step = () => {
      if (!running) return;
      raf = requestAnimationFrame(step);
      if (video.readyState < 2) return;
      const now = performance.now();
      if (now - lastTs < 80) return; // about 12 frames a second is plenty
      lastTs = now; frame++;
      const w = video.videoWidth, h = video.videoHeight;
      const fr = tasks.face.detectForVideo(video, now);
      const hr = tasks.hand.detectForVideo(video, now);
      const objects = frame % 2 === 0 ? tasks.object.detectForVideo(video, now + 0.5).detections : null;

      // The closest person = the biggest face.
      let best = null;
      (fr.faceLandmarks || []).forEach(lm => { const b = faceBox(lm, w, h); if (!best || b.w * b.h > best.box.w * best.box.h) best = { lm, box: b }; });

      let isOwner = false;
      if (best) {
        const sig = signature(best.lm, w, h);
        if (learning) {
          if (frontal(best.lm)) samples.push(sig);
          if (samples.length >= 24) {
            const ref = sig.map((_, i) => samples.map(s => s[i]).sort((a, b) => a - b)[samples.length >> 1]);
            owner = { sig: ref, learnedAt: Date.now() };
            learning = false; onLearned?.(owner); set('learned');
            ownerBox = best.box; ownerAt = now;
          }
        } else if (!ownerCheck) {
          isOwner = true;
        } else if (owner) {
          const trusted = ownerBox && now - ownerAt < OWNER_TRUST_MS && iou(best.box, ownerBox) > 0.3;
          if (frontal(best.lm) && signatureDistance(sig, owner.sig) < OWNER_THRESHOLD) { isOwner = true; ownerBox = best.box; ownerAt = now; }
          else if (trusted) { isOwner = true; ownerBox = best.box; }
        }
        if (isOwner) {
          const a = best.lm[13], b = best.lm[14];
          mouth = { x: (a.x + b.x) / 2 * w, y: (a.y + b.y) / 2 * h };
          faceW = best.box.w; faceSeenAt = now;
        }
      }
      const mouthKnown = mouth && now - faceSeenAt < FACE_MEMORY_MS;

      let handAtMouth = false, objectAtMouth = false;
      const nearObjects = [];
      if (mouthKnown) {
        const reach = faceW * 0.9;
        for (const lm of hr.landmarks || []) {
          for (const i of [0, 4, 5, 8, 9, 12, 17]) {
            if (Math.hypot(lm[i].x * w - mouth.x, lm[i].y * h - mouth.y) < reach) { handAtMouth = true; break; }
          }
        }
        if (objects) {
          for (const d of objects) {
            const b = d.boundingBox; const pad = faceW * 0.45;
            const near = mouth.x > b.originX - pad && mouth.x < b.originX + b.width + pad && mouth.y > b.originY - pad && mouth.y < b.originY + b.height + pad;
            if (near) { objectAt = now; nearObjects.push(d); }
            const inside = mouth.x > b.originX - pad * 0.3 && mouth.x < b.originX + b.width + pad * 0.3 && mouth.y > b.originY - pad * 0.6 && mouth.y < b.originY + b.height + pad * 0.3;
            if (inside) objectAtMouth = true;
          }
        }
      }
      const objectRecent = now - objectAt < OBJECT_MEMORY_MS;
      const drinking = mouthKnown && (objectAtMouth || (handAtMouth && objectRecent));

      if (drinking) {
        if (!poseSince) poseSince = now;
        const held = now - poseSince;
        if ((held >= SIP_HOLD_MS && lastSipAt < poseSince) || (lastSipAt >= poseSince && now - lastSipAt >= SIP_REPEAT_MS)) {
          sips++; lastSipAt = now; onSip?.(sips);
        }
        set('drinking');
      } else {
        poseSince = 0;
        if (!learning) set(best && !isOwner && owner && !(ownerBox && now - ownerAt < OWNER_TRUST_MS) ? 'stranger' : mouthKnown ? 'ready' : 'looking');
      }
      onFrame?.({ w, h, faces: fr.faceLandmarks || [], best, isOwner, hands: hr.landmarks || [], objects: objects || null, nearObjects, mouth: mouthKnown ? mouth : null, drinking });
    };
    step();
  }).catch(err => { if (running) onStatus?.('error', err); });

  return {
    stop() { running = false; cancelAnimationFrame(raf); },
    get sips() { return sips; },
  };
}
