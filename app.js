import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

const VIDEO = document.getElementById("camera");
const CANVAS = document.getElementById("effects");
const CTX = CANVAS.getContext("2d", { alpha: false });

// Ajustes adaptativos: menos resolución y menos inferencias en teléfonos.
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (window.matchMedia?.("(pointer: coarse)").matches && window.innerWidth <= 900);
const RENDER_INTERVAL_MS = IS_MOBILE ? 1000 / 24 : 1000 / 45;
const DETECTION_INTERVAL_MS = IS_MOBILE ? 1000 / 13 : 1000 / 30;

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Contornos faciales de MediaPipe Face Mesh.
const LEFT_EYE = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const RIGHT_EYE = [362, 398, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382];
const MOUTH_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

let landmarker = null;
let lastDetectionVideoTime = -1;
let previousFrameTime = 0;
let lastRenderTime = 0;
let lastInferenceTime = 0;
let lastFireSpawnTime = 0;
let lastResult = null;
let mouthWasOpen = false;
let particles = [];
let lastFacePoints = null;
let isEyeClosed = false;
let isMouthOpen = false;

const viewport = { width: 0, height: 0, dpr: 1 };

function resizeCanvas() {
  viewport.width = window.innerWidth;
  viewport.height = window.innerHeight;
  viewport.dpr = Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 1.2 : 2);
  CANVAS.width = Math.round(viewport.width * viewport.dpr);
  CANVAS.height = Math.round(viewport.height * viewport.dpr);
  CANVAS.style.width = `${viewport.width}px`;
  CANVAS.style.height = `${viewport.height}px`;
  CTX.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
}

window.addEventListener("resize", resizeCanvas, { passive: true });
resizeCanvas();

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador no ofrece acceso a cámara en este origen.");
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        // 640x480 reduce bastante la carga en Android y conserva detalle suficiente.
        width: { ideal: IS_MOBILE ? 640 : 1280 },
        height: { ideal: IS_MOBILE ? 480 : 720 },
        frameRate: IS_MOBILE ? { ideal: 24, max: 30 } : { ideal: 30, max: 60 }
      }
    });
  } catch (firstError) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }

  VIDEO.srcObject = stream;
  await VIDEO.play();
  await new Promise((resolve) => {
    if (VIDEO.videoWidth > 0) resolve();
    else VIDEO.addEventListener("loadedmetadata", resolve, { once: true });
  });
}

async function createLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const baseOptions = { modelAssetPath: MODEL_URL };

  // Intenta GPU primero y vuelve a CPU en equipos donde GPU no esté disponible.
  try {
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { ...baseOptions, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55
    });
  } catch (gpuError) {
    console.warn("GPU no disponible; usando CPU.", gpuError);
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { ...baseOptions, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55
    });
  }
}

function mapLandmark(point) {
  // Replica el recorte de object-fit: cover y el espejo de la cámara frontal.
  const videoWidth = VIDEO.videoWidth || viewport.width;
  const videoHeight = VIDEO.videoHeight || viewport.height;
  const scale = Math.max(viewport.width / videoWidth, viewport.height / videoHeight);
  const renderedWidth = videoWidth * scale;
  const renderedHeight = videoHeight * scale;
  const cropX = (renderedWidth - viewport.width) / 2;
  const cropY = (renderedHeight - viewport.height) / 2;
  const xBeforeMirror = point.x * renderedWidth - cropX;
  return {
    x: viewport.width - xBeforeMirror,
    y: point.y * renderedHeight - cropY,
    z: point.z || 0
  };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centerOf(points) {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}

function smoothClosedPath(ctx, points) {
  if (points.length < 3) return;
  const firstMid = {
    x: (points[points.length - 1].x + points[0].x) / 2,
    y: (points[points.length - 1].y + points[0].y) / 2
  };
  ctx.beginPath();
  ctx.moveTo(firstMid.x, firstMid.y);
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const mid = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
    ctx.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
  }
  ctx.closePath();
}

function deterministicNoise(seed) {
  const value = Math.sin(seed * 127.1 + 19.19) * 43758.5453123;
  return value - Math.floor(value);
}

function expandedPoints(points, scaleX, scaleY = scaleX) {
  const center = centerOf(points);
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * scaleX,
    y: center.y + (point.y - center.y) * scaleY
  }));
}

function drawDryBrushTexture(ctx, outline, width, seed) {
  // Pequeñas pinceladas irregulares alrededor del contorno para evitar el aspecto de sticker.
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0; i < outline.length; i += 2) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    for (let k = 0; k < (IS_MOBILE ? 1 : 2); k++) {
      const n = deterministicNoise(seed + i * 3 + k * 11);
      const offset = (n - 0.5) * width * 0.24;
      const extension = width * (0.025 + n * 0.07);
      ctx.beginPath();
      ctx.moveTo(a.x + nx * offset, a.y + ny * offset);
      ctx.lineTo(b.x + nx * offset + (n - 0.5) * extension, b.y + ny * offset + (n - 0.5) * extension);
      ctx.strokeStyle = k === 0 ? "rgba(0,0,0,.86)" : "rgba(19,17,17,.9)";
      ctx.lineWidth = Math.max(1.1, width * (0.012 + n * 0.024));
      ctx.stroke();
    }
  }

  const c = centerOf(outline);
  for (let i = 0; i < (IS_MOBILE ? 9 : 15); i++) {
    const point = outline[i % outline.length];
    const n = deterministicNoise(seed * 4 + i * 7.9);
    const angle = Math.atan2(point.y - c.y, point.x - c.x) + (n - 0.5) * 1.4;
    const length = width * (0.04 + n * 0.105);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x + Math.cos(angle) * length, point.y + Math.sin(angle) * length);
    ctx.strokeStyle = "rgba(2,2,3,.95)";
    ctx.lineWidth = Math.max(1.4, width * (0.012 + n * 0.027));
    ctx.stroke();
  }
  ctx.restore();
}

function drawEyeSocket(ctx, allPoints, indices, seed) {
  const eyePoints = indices.map((index) => allPoints[index]).filter(Boolean);
  if (eyePoints.length < 10) return null;
  const center = centerOf(eyePoints);
  const expanded = expandedPoints(eyePoints, 1.48, 1.82);
  const box = expanded.reduce((acc, p) => ({
    minX: Math.min(acc.minX, p.x), maxX: Math.max(acc.maxX, p.x),
    minY: Math.min(acc.minY, p.y), maxY: Math.max(acc.maxY, p.y)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const eyeWidth = box.maxX - box.minX;

  ctx.save();
  smoothClosedPath(ctx, expanded);
  ctx.fillStyle = "#030303";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.98)";
  ctx.lineWidth = Math.max(3, eyeWidth * 0.075);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();

  // Manchas mates y trazos negros dentro y fuera del maquillaje.
  ctx.globalAlpha = 0.42;
  ctx.lineWidth = Math.max(1.5, eyeWidth * 0.018);
  ctx.strokeStyle = "#373333";
  for (let i = 0; i < 7; i++) {
    const y = box.minY + (box.maxY - box.minY) * (0.15 + i * 0.11);
    ctx.beginPath();
    ctx.moveTo(box.minX + eyeWidth * 0.16, y);
    ctx.quadraticCurveTo(center.x, y + (i % 2 ? 4 : -4), box.maxX - eyeWidth * 0.12, y + 1.5);
    ctx.stroke();
  }
  ctx.restore();

  drawDryBrushTexture(ctx, expanded, eyeWidth, seed);
  return { center, width: box.maxX - box.minX, height: box.maxY - box.minY, box, source: eyePoints };
}

function drawNosePaint(ctx, p, faceWidth) {
  const bridge = p[168] || p[6];
  const leftWing = p[98];
  const rightWing = p[327];
  const tip = p[1] || p[2];
  if (!bridge || !leftWing || !rightWing || !tip) return;

  const noseWidth = dist(leftWing, rightWing);
  const points = [
    { x: bridge.x, y: bridge.y - faceWidth * 0.006 },
    { x: leftWing.x - noseWidth * 0.1, y: leftWing.y + noseWidth * 0.03 },
    { x: leftWing.x + noseWidth * 0.12, y: tip.y + noseWidth * 0.11 },
    { x: tip.x, y: tip.y + noseWidth * 0.12 },
    { x: rightWing.x - noseWidth * 0.12, y: tip.y + noseWidth * 0.11 },
    { x: rightWing.x + noseWidth * 0.1, y: rightWing.y + noseWidth * 0.03 }
  ];
  ctx.save();
  smoothClosedPath(ctx, points);
  ctx.fillStyle = "#030303";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.95)";
  ctx.lineWidth = Math.max(2, faceWidth * 0.012);
  ctx.stroke();

  // Textura tipo pintura aplicada con brocha.
  ctx.strokeStyle = "rgba(24,22,22,.9)";
  ctx.lineCap = "round";
  for (let i = 0; i < 8; i++) {
    const n = deterministicNoise(i + 8.4);
    const x = tip.x + (n - 0.5) * noseWidth * 0.52;
    ctx.beginPath();
    ctx.moveTo(x, tip.y - noseWidth * 0.08);
    ctx.lineTo(x + (n - 0.5) * noseWidth * 0.17, tip.y + noseWidth * (0.1 + n * 0.12));
    ctx.lineWidth = Math.max(1, noseWidth * (0.015 + n * 0.02));
    ctx.stroke();
  }
  ctx.restore();
}

function drawCheekMarks(ctx, p, socketInfos, faceWidth) {
  if (!socketInfos[0] || !socketInfos[1] || !p[61] || !p[291]) return;
  const faceCenter = p[1]?.x ?? (viewport.width / 2);
  const mouthCorners = [p[61], p[291]];

  for (const socket of socketInfos) {
    const side = socket.center.x < faceCenter ? -1 : 1;
    const outerX = side < 0 ? socket.box.minX : socket.box.maxX;
    const start = { x: outerX - side * faceWidth * 0.005, y: socket.center.y + socket.height * 0.23 };
    const corner = mouthCorners.reduce((best, item) =>
      Math.abs(item.x - socket.center.x) < Math.abs(best.x - socket.center.x) ? item : best, mouthCorners[0]);
    const end = { x: corner.x + side * faceWidth * 0.025, y: corner.y - faceWidth * 0.02 };

    ctx.save();
    for (let i = 0; i < 3; i++) {
      const shift = (i - 1) * faceWidth * 0.016;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y + shift);
      ctx.quadraticCurveTo(
        (start.x + end.x) / 2 + side * faceWidth * 0.025,
        (start.y + end.y) / 2 + shift,
        end.x,
        end.y + shift * 0.35
      );
      ctx.strokeStyle = i === 1 ? "rgba(2,2,2,.96)" : "rgba(6,6,6,.78)";
      ctx.lineCap = "round";
      ctx.lineWidth = faceWidth * (i === 1 ? 0.026 : 0.012);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawMouthPaint(ctx, p, faceWidth) {
  const mouthPoints = MOUTH_OUTER.map((index) => p[index]).filter(Boolean);
  if (mouthPoints.length < 16 || !p[61] || !p[291] || !p[13] || !p[14]) return null;

  const center = { x: (p[13].x + p[14].x) / 2, y: (p[13].y + p[14].y) / 2 };
  const width = dist(p[61], p[291]);
  const angle = Math.atan2(p[291].y - p[61].y, p[291].x - p[61].x);
  const opening = dist(p[13], p[14]) / Math.max(width, 1);
  const scaled = mouthPoints.map((pt) => ({
    x: center.x + (pt.x - center.x) * 1.08,
    y: center.y + (pt.y - center.y) * 1.18
  }));

  ctx.save();
  smoothClosedPath(ctx, scaled);
  ctx.fillStyle = "#030303";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,.98)";
  ctx.lineWidth = Math.max(2, width * 0.035);
  ctx.stroke();

  // Tira de dientes color hueso con costuras negras, inspirada en pintacaritas.
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  const teethWidth = width * 0.82;
  const teethHeight = Math.max(width * 0.055, Math.min(width * 0.19, opening * width * 0.72 + width * 0.045));
  ctx.beginPath();
  ctx.moveTo(-teethWidth * 0.5, -teethHeight * 0.34);
  ctx.quadraticCurveTo(-teethWidth * 0.12, -teethHeight * 0.59, teethWidth * 0.5, -teethHeight * 0.25);
  ctx.lineTo(teethWidth * 0.49, teethHeight * 0.30);
  ctx.quadraticCurveTo(0, teethHeight * 0.56, -teethWidth * 0.5, teethHeight * 0.25);
  ctx.closePath();
  ctx.fillStyle = "#d8d0c4";
  ctx.fill();
  ctx.strokeStyle = "#080808";
  ctx.lineWidth = Math.max(1.5, width * 0.018);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-teethWidth * 0.48, 0);
  ctx.quadraticCurveTo(0, -teethHeight * 0.09, teethWidth * 0.48, 0);
  ctx.strokeStyle = "#060606";
  ctx.lineWidth = Math.max(1.4, width * 0.019);
  ctx.stroke();

  const toothCount = 9;
  for (let i = 1; i < toothCount; i++) {
    const x = -teethWidth / 2 + (teethWidth / toothCount) * i;
    const n = deterministicNoise(i * 3.2);
    const offset = (n - 0.5) * teethHeight * 0.35;
    ctx.beginPath();
    ctx.moveTo(x, -teethHeight * (0.48 + n * 0.08));
    ctx.lineTo(x + offset, teethHeight * (0.42 + n * 0.08));
    ctx.strokeStyle = "#080808";
    ctx.lineWidth = Math.max(1.5, width * (0.012 + n * 0.009));
    ctx.stroke();
  }
  // Costuras extra por fuera de la boca.
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2, width * 0.025);
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sign * teethWidth * 0.43, -teethHeight * 0.65);
    ctx.lineTo(sign * teethWidth * 0.50, teethHeight * 0.50);
    ctx.strokeStyle = "#050505";
    ctx.stroke();
  }
  ctx.restore();

  return { center, width, opening, angle };
}

function getBlendshapeScore(result, name) {
  const categories = result.faceBlendshapes?.[0]?.categories;
  if (!categories) return 0;
  return categories.find((item) => item.categoryName === name)?.score ?? 0;
}

function drawRedEyes(ctx, infos, blinkStrength) {
  if (!infos[0] || !infos[1]) return;
  for (const eye of infos) {
    const radiusX = Math.max(eye.width * 0.46, 12);
    const radiusY = Math.max(eye.height * 0.49, 8);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const glow = ctx.createRadialGradient(eye.center.x, eye.center.y, 1, eye.center.x, eye.center.y, radiusX * 1.25);
    glow.addColorStop(0, `rgba(255,18,20,${0.68 + blinkStrength * 0.25})`);
    glow.addColorStop(0.38, `rgba(255,0,12,${0.38 + blinkStrength * 0.18})`);
    glow.addColorStop(1, "rgba(175,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(eye.center.x, eye.center.y, radiusX * 1.25, radiusY * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();

    const edgeX = eye.source.map((point) => point.x);
    const left = Math.min(...edgeX);
    const right = Math.max(...edgeX);
    ctx.shadowColor = "#ff1010";
    ctx.shadowBlur = 16 + blinkStrength * 12;
    ctx.strokeStyle = "rgba(255,30,32,.98)";
    ctx.lineWidth = Math.max(2.5, eye.width * 0.075);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(left + eye.width * 0.14, eye.center.y);
    ctx.quadraticCurveTo(eye.center.x, eye.center.y + radiusY * 0.04, right - eye.width * 0.14, eye.center.y);
    ctx.stroke();
    ctx.restore();
  }
}

function addFireParticles(origin, mouthWidth, strength) {
  const count = Math.max(2, Math.round(2 + strength * 4));
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * mouthWidth * 0.72;
    particles.push({
      x: origin.x + spread,
      y: origin.y + (Math.random() - 0.5) * Math.max(5, mouthWidth * 0.06),
      vx: (Math.random() - 0.5) * mouthWidth * 0.8,
      vy: -(mouthWidth * (0.75 + Math.random() * 1.8)),
      size: mouthWidth * (0.075 + Math.random() * 0.12),
      age: 0,
      life: 0.28 + Math.random() * 0.46,
      twist: (Math.random() - 0.5) * 0.8
    });
  }
  if (particles.length > 170) particles.splice(0, particles.length - 170);
}

function drawFlameTongue(ctx, x, y, size, age, seed = 0) {
  const flicker = 0.78 + 0.22 * Math.sin(age * 23 + seed * 2.7);
  const w = size * flicker;
  const h = size * (1.55 + 0.35 * Math.sin(age * 17 + seed));
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = "screen";
  ctx.shadowColor = "#ff3b04";
  ctx.shadowBlur = size * (IS_MOBILE ? 0.45 : 0.85);
  const grad = ctx.createLinearGradient(0, size * 0.42, 0, -h);
  grad.addColorStop(0, "rgba(255,245,146,.98)");
  grad.addColorStop(0.25, "rgba(255,151,24,.98)");
  grad.addColorStop(0.64, "rgba(255,45,4,.88)");
  grad.addColorStop(1, "rgba(160,0,0,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-w * 0.54, size * 0.42);
  ctx.bezierCurveTo(-w * 0.82, size * 0.05, -w * 0.13, -h * 0.44, w * (0.08 + 0.08 * Math.sin(age * 25 + seed)) , -h);
  ctx.bezierCurveTo(w * 0.57, -h * 0.39, w * 0.76, size * 0.03, w * 0.47, size * 0.42);
  ctx.quadraticCurveTo(0, size * 0.72, -w * 0.54, size * 0.42);
  ctx.closePath();
  ctx.fill();

  const inner = ctx.createLinearGradient(0, size * 0.3, 0, -h * 0.62);
  inner.addColorStop(0, "rgba(255,255,216,.96)");
  inner.addColorStop(0.45, "rgba(255,207,52,.85)");
  inner.addColorStop(1, "rgba(255,120,12,0)");
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.moveTo(-w * 0.20, size * 0.35);
  ctx.quadraticCurveTo(-w * 0.05, -h * 0.16, w * 0.10, -h * 0.56);
  ctx.quadraticCurveTo(w * 0.33, -h * 0.05, w * 0.23, size * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHeadFlames(ctx, p, faceWidth, now) {
  if (!p[10] || !p[234] || !p[454]) return;

  const time = now / 1000;
  const left = p[234];
  const top = p[10];
  const right = p[454];

  // Llamas desde la sien izquierda hasta la frente.
  // Y después desde la frente hasta la sien derecha.
  const flameSegments = IS_MOBILE ? 5 : 6;
  for (let side = 0; side < 2; side++) {
    const start = side === 0 ? left : top;
    const end = side === 0 ? top : right;

    for (let i = 0; i <= flameSegments; i++) {
      const t = i / flameSegments;
      const x = start.x + (end.x - start.x) * t;
      const y = start.y + (end.y - start.y) * t;

      // Las llamas laterales se separan un poco de la cara.
      const outward = side === 0 ? -1 : 1;
      const sideOffset =
        side === 0
          ? -Math.sin(t * Math.PI / 2) * faceWidth * 0.035
          : Math.sin(t * Math.PI / 2) * faceWidth * 0.035;

      const topLift = Math.sin(t * Math.PI) * faceWidth * 0.045;
      const flicker = 0.82 + 0.18 * Math.sin(time * 9 + i * 2.1 + side);
      const flameX = x + sideOffset;
      const flameY = y - topLift - faceWidth * 0.40;
      const size = faceWidth * (0.16 + 0.07 * flicker);

      ctx.save();
      ctx.globalAlpha = 0.88;
      drawFlameTongue(ctx, flameX, flameY, size, time, i * 1.7 + side * 5);
      ctx.restore();
    }
  }
}


function updateAndDrawFire(ctx, dt, now, mouth, jawOpen) {
  if (mouth && isMouthOpen) {
    // Limita el nacimiento de partículas en móviles para evitar saturar el canvas.
    if (now - lastFireSpawnTime >= (IS_MOBILE ? 90 : 45)) {
      addFireParticles({ x: mouth.center.x, y: mouth.center.y - mouth.width * 0.03 }, mouth.width, Math.max(jawOpen, mouth.opening));
      lastFireSpawnTime = now;
    }
    // Llamas principales que nacen del centro de la boca.
    const time = now / 1000;
    for (let i = -2; i <= 2; i++) {
      const seed = i + 3;
      const x = mouth.center.x + i * mouth.width * 0.095 + Math.sin(time * 12 + seed) * mouth.width * 0.025;
      const y = mouth.center.y - mouth.width * (0.015 + Math.abs(i) * 0.008);
      drawFlameTongue(ctx, x, y, mouth.width * (0.13 - Math.abs(i) * 0.012), time, seed);
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];
    particle.age += dt;
    if (particle.age >= particle.life) {
      particles.splice(i, 1);
      continue;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy -= 85 * dt;
    particle.vx *= Math.max(0, 1 - dt * 1.4);
    const progress = particle.age / particle.life;
    const alpha = Math.sin(Math.PI * progress) * (1 - progress * 0.23);
    ctx.save();
    ctx.globalAlpha = alpha;
    drawFlameTongue(ctx, particle.x, particle.y, particle.size * (1 - progress * 0.28), now / 1000 + particle.age, particle.twist);
    // Brasas luminosas.
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = progress < 0.55 ? "#ffc44d" : "#ff4208";
    ctx.shadowColor = "#ff4b04";
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, Math.max(0.8, particle.size * 0.07), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawCameraFrame() {
  CTX.clearRect(0, 0, viewport.width, viewport.height);
  if (VIDEO.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !VIDEO.videoWidth || !VIDEO.videoHeight) return;

  // Dibuja el video directamente en el canvas, con el mismo recorte cover
  // y espejo usados por mapLandmark(). Esto evita el video negro en algunos Android.
  const scale = Math.max(viewport.width / VIDEO.videoWidth, viewport.height / VIDEO.videoHeight);
  const renderedWidth = VIDEO.videoWidth * scale;
  const renderedHeight = VIDEO.videoHeight * scale;
  const cropX = (renderedWidth - viewport.width) / 2;
  const cropY = (renderedHeight - viewport.height) / 2;

  CTX.save();
  CTX.translate(viewport.width, 0);
  CTX.scale(-1, 1);
  CTX.drawImage(VIDEO, -cropX, -cropY, renderedWidth, renderedHeight);
  CTX.restore();
}

function renderMask(result, now, dt) {
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks || landmarks.length < 300) {
    lastFacePoints = null;
    isMouthOpen = false;
    isEyeClosed = false;
    updateAndDrawFire(CTX, dt, now, null, 0);
    return;
  }

  const points = landmarks.map(mapLandmark);
  lastFacePoints = points;
  const faceWidth = dist(points[234], points[454]) || viewport.width * 0.28;

  // Fuego animado alrededor de la cabeza, detrás del maquillaje.
  drawHeadFlames(CTX, points, faceWidth, now);

  const leftSocket = drawEyeSocket(CTX, points, LEFT_EYE, 3);
  const rightSocket = drawEyeSocket(CTX, points, RIGHT_EYE, 17);
  const eyeInfos = [leftSocket, rightSocket];

  // drawCheekMarks(CTX, points, eyeInfos, faceWidth);
  drawNosePaint(CTX, points, faceWidth);
  const mouth = drawMouthPaint(CTX, points, faceWidth);

  const blinkLeft = getBlendshapeScore(result, "eyeBlinkLeft");
  const blinkRight = getBlendshapeScore(result, "eyeBlinkRight");
  const jawOpen = getBlendshapeScore(result, "jawOpen");

  const ear = (eyeInfos[0] && eyeInfos[1])
    ? (dist(points[159], points[145]) + dist(points[158], points[153])) / (2 * Math.max(dist(points[33], points[133]), 1))
      + (dist(points[386], points[374]) + dist(points[385], points[380])) / (2 * Math.max(dist(points[362], points[263]), 1))
    : 1;
  const earAverage = ear / 2;
  isEyeClosed = (blinkLeft > 0.38 && blinkRight > 0.38) || earAverage < 0.115;

  const openingRatio = mouth?.opening ?? 0;
  isMouthOpen = jawOpen > 0.34 || openingRatio > 0.155;

  if (isEyeClosed) {
    const intensity = Math.min(1, Math.max(blinkLeft, blinkRight, 0.55));
    drawRedEyes(CTX, eyeInfos, intensity);
  }

  // El fuego se dibuja al final, de modo que parezca salir de la boca.
  updateAndDrawFire(CTX, dt, now, mouth, jawOpen);
  mouthWasOpen = isMouthOpen;
}

function animationLoop(now) {
  // El canvas se actualiza a una tasa controlada. En Android renderiza a 24 fps
  // y MediaPipe analiza solo 13 fps; la última detección se reutiliza entre medias.
  if (VIDEO.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      VIDEO.videoWidth > 0 && now - lastRenderTime >= RENDER_INTERVAL_MS) {
    const dt = previousFrameTime ? Math.min((now - previousFrameTime) / 1000, 0.07) : 1 / 24;
    previousFrameTime = now;
    lastRenderTime = now;

    // Fondo y efectos se componen en el mismo canvas para evitar la capa negra en Android.
    drawCameraFrame();

    if (landmarker && VIDEO.currentTime !== lastDetectionVideoTime &&
        now - lastInferenceTime >= DETECTION_INTERVAL_MS) {
      try {
        lastResult = landmarker.detectForVideo(VIDEO, now);
        lastDetectionVideoTime = VIDEO.currentTime;
        lastInferenceTime = now;
      } catch (error) {
        console.warn("No se pudo procesar el fotograma.", error);
        lastResult = null;
      }
    }

    if (lastResult) renderMask(lastResult, now, dt);
    else updateAndDrawFire(CTX, dt, now, null, 0);
  }

  requestAnimationFrame(animationLoop);
}

async function main() {
  try {
    await startCamera();
    await createLandmarker();
    requestAnimationFrame(animationLoop);
  } catch (error) {
    // No se muestra ningún texto encima de la cámara, tal como pide el diseño.
    console.error("No se pudo iniciar el filtro. Verifica permisos de cámara y conexión.", error);
  }
}

main();
