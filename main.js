import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, NoiseEffect, ChromaticAberrationEffect, VignetteEffect, DepthOfFieldEffect, BlendFunction } from 'postprocessing';

let scene, camera, renderer, composer;
let material, clock;
let instancedMesh;
let appState = 'MATRIX'; // MATRIX, CHOICE_MADE, BULLET_TIME, END_RED, BLUE_SIM

// Variables para el control de vídeo y scroll virtual
let video, videoTexture, videoMaterial, videoMesh;
let bulletVideo, bulletTexture, bulletMaterial, bulletMesh;
let scrollProgress = 0.0;
let targetScrollProgress = 0.0;

// Caché para optimizar el reciclado de la lluvia de código
let instancedPositions;

// Efectos de postprocesado para rack focus y ajustes dinámicos
let dofEffect;

// Control de opacidades para la transición fluida
let bulletVideoLoaded = false;
let transitionOpacityMatrix = 1.0;
let transitionOpacityVideo = 0.0;
let transitionOpacityBullet = 0.0;

// Detección de preferencia de movimiento reducido
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Variables para la interacción y animación cinematográfica
let targetHoverRed = 0.0;
let targetHoverBlue = 0.0;
let currentHoverRed = 0.0;
let currentHoverBlue = 0.0;
let cameraSpeed = 0.002;
let frameCount = 0;
let interactionsActivated = false;

console.log("main.js loaded. Prefers reduced motion:", prefersReducedMotion);

// 1. GENERADOR DE TEXTURAS PROCEDIMENTAL (Lluvia de Código)
function createCharacterTexture() {
  console.log("Generating character texture...");
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Limpiar con negro transparente
  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Propiedades de fuente
  ctx.font = 'bold 44px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';

  // Selección de 16 glifos (Katakana y dígitos numéricos)
  const chars = [
    'ｱ', 'ﾒ', 'ﾘ', 'ｶ', 'ｻ', 'ｽ', 'ｾ', 'ｿ', 'ﾂ', 'ﾄ', 'ﾅ', 'ﾊ', 'ﾋ', '0', '7', '9'
  ];

  for (let i = 0; i < 16; i++) {
    const char = chars[i];
    ctx.fillText(char, 32, i * 64 + 32);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  console.log("Character texture generated.");
  return texture;
}

// 3. SHADERS NATIVOS PERSONALIZADOS DE LA LLUVIA DE CÓDIGO (GLSL)
const vertexShader = `
  attribute vec3 aRandom;
  varying vec2 vUv;
  varying vec3 vRandom;

  #include <fog_pars_vertex>

  void main() {
    vUv = uv;
    vRandom = aRandom;

    #ifdef USE_INSTANCING
      vec4 localPosition = instanceMatrix * vec4(position, 1.0);
    #else
      vec4 localPosition = vec4(position, 1.0);
    #endif

    vec4 mvPosition = modelViewMatrix * localPosition;
    gl_Position = projectionMatrix * mvPosition;

    #include <fog_vertex>
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform sampler2D uTexture;
  uniform float uHoverRed;
  uniform float uHoverBlue;
  uniform float uMatrixOpacity;
  varying vec2 vUv;
  varying vec3 vRandom;

  #include <fog_pars_fragment>

  // Función pseudo-aleatoria
  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    // Segmentación en 24 celdas verticales
    float numCells = 24.0;
    float cellY = floor(vUv.y * numCells);
    
    // UVs locales para la celda
    float localU = vUv.x;
    float localV = fract(vUv.y * numCells);

    // Glitch geométrico: distorsionar las UVs locales usando la función random existente
    float glitchNoise = random(vec2(floor(uTime * 25.0), cellY));
    
    float distU = localU;
    float distV = localV;
    
    // Si uHoverRed aumenta (hover en la píldora roja), distorsionar celdas
    if (uHoverRed > 0.05 && glitchNoise < uHoverRed * 0.45) {
      distU = fract(localU + glitchNoise * 0.45);
      distV = fract(localV + glitchNoise * 0.45);
    }
    
    // Si uHoverBlue supera 2.0 (click en píldora azul -> Glitch masivo)
    if (uHoverBlue > 2.0) {
      distU = fract(localU + glitchNoise * 2.0);
      distV = fract(localV + glitchNoise * 2.0);
    }

    // Mutación del carácter basada en tiempo y ratio de mutación
    float mutationSpeed = 3.0 + vRandom.z * 12.0;
    float timeStep = floor(uTime * mutationSpeed + random(vec2(cellY, vRandom.y)) * 100.0);
    float glyphRand = random(vec2(cellY, timeStep));
    float glyphIdx = floor(glyphRand * 16.0);

    // Mapeo en el atlas de textura vertical (16 caracteres) con distorsión
    vec2 uvAtlas = vec2(distU, (15.0 - glyphIdx + distV) / 16.0);
    float charTex = texture2D(uTexture, uvAtlas).r;

    // Cálculo del flujo de caída
    float speed = 0.4 + vRandom.x * 1.2;
    float offset = vRandom.y * 20.0;
    float progress = fract(uTime * speed + offset);
    
    // La cabeza de la estela viaja de arriba (1.0) hacia abajo (0.0)
    float headY = 1.0 - progress;

    // Distancia desde el fragmento actual a la cabeza
    float dist = vUv.y - headY;
    if (dist < 0.0) {
      dist += 1.0;
    }

    // Decaimiento exponencial de la cola (difuminado)
    float tailLength = 4.5;
    float intensity = exp(-dist * tailLength);

    // Cabeza incandescente brillante (glowing tip)
    float headGlow = smoothstep(0.08, 0.0, dist);

    // Mezcla cromática base: verde fósforo clásico y blanco incandescente
    vec3 greenColor = vec3(0.0, 0.9, 0.2);
    vec3 whiteColor = vec3(0.85, 1.0, 0.9);

    // Hover píldora roja: virado cromático a rojo/blanco cálido
    vec3 redColor = vec3(0.9, 0.1, 0.15);
    greenColor = mix(greenColor, redColor, uHoverRed * 0.95);
    whiteColor = mix(whiteColor, vec3(1.0, 0.4, 0.4), uHoverRed * 0.6);

    // Hover píldora azul: virado cromático a azul/blanco gélido
    vec3 blueColor = vec3(0.1, 0.3, 0.95);
    greenColor = mix(greenColor, blueColor, uHoverBlue * 0.95);
    whiteColor = mix(whiteColor, vec3(0.6, 0.85, 1.0), uHoverBlue * 0.6);

    vec3 finalColor = mix(greenColor, whiteColor, headGlow * 0.85);

    gl_FragColor = vec4(finalColor * intensity * charTex * uMatrixOpacity, intensity * charTex * uMatrixOpacity);

    // Aplicar niebla nativa
    #include <fog_fragment>
  }
`;

// SHADER DE INTEGRACIÓN PARA EL VÍDEO (Edge-Fade Vignette)
const videoVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const videoFragmentShader = `
  uniform sampler2D uVideoTexture;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec4 texColor = texture2D(uVideoTexture, vUv);
    
    // Suavizado en los 4 bordes externos (Vignette interna) usando smoothstep
    float edgeFade = smoothstep(0.0, 0.2, vUv.x) * 
                     smoothstep(1.0, 0.8, vUv.x) * 
                     smoothstep(0.0, 0.2, vUv.y) * 
                     smoothstep(1.0, 0.8, vUv.y);
                     
    // Multiplicar color por el degradado de bordes y por la opacidad controlada por scroll
    gl_FragColor = vec4(texColor.rgb * edgeFade * uOpacity, texColor.a * edgeFade * uOpacity);
  }
`;

function init() {
  console.log("init() starting...");
  
  // Escena y Niebla para volumen
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.015);
  console.log("Scene and fog configured.");

  // Cámara Cinematográfica
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 5;
  console.log("Camera configured at Z:", camera.position.z);

  // Renderer de alto rendimiento
  const canvasElement = document.querySelector('#matrix-canvas');
  if (!canvasElement) {
    console.error("Canvas element '#matrix-canvas' NOT found!");
    return;
  }

  renderer = new THREE.WebGLRenderer({
    canvas: canvasElement,
    antialias: false,
    powerPreference: "high-performance"
  });
  console.log("WebGLRenderer instantiated.");

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Inicializar reloj
  clock = new THREE.Clock();

  // 1. CREACIÓN PROGRAMÁTICA DEL ELEMENTO DE VÍDEO
  video = document.createElement('video');
  video.src = '/morfeo_pills_opt.mp4';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.loop = false;
  console.log("Programmatic video element initialized.");

  videoTexture = new THREE.VideoTexture(video);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;

  // CREACIÓN PROGRAMÁTICA DEL VÍDEO DE BULLET-TIME (con fallback dinámico y audio)
  bulletVideo = document.createElement('video');
  bulletVideo.src = '/bullet_time.mp4';
  bulletVideo.preload = 'auto';
  bulletVideo.muted = false; // Permitimos audio porque se reproduce tras el click del usuario
  bulletVideo.playsInline = true;
  bulletVideo.setAttribute('playsinline', '');
  bulletVideo.setAttribute('webkit-playsinline', '');
  bulletVideo.loop = false;
  bulletVideo.addEventListener('error', () => {
    console.warn("bullet_time.mp4 not found, falling back to /morfeo_pills_opt.mp4");
    bulletVideo.src = '/morfeo_pills_opt.mp4';
    bulletVideo.muted = true; // El fallback se reproduce silenciado
  });
  bulletVideo.addEventListener('ended', () => {
    console.log("bulletVideo ended, transitioning to END_RED");
    transitionToEndRed();
  });
  console.log("Programmatic bulletVideo element initialized.");

  bulletTexture = new THREE.VideoTexture(bulletVideo);
  bulletTexture.minFilter = THREE.LinearFilter;
  bulletTexture.magFilter = THREE.LinearFilter;

  // 2. CÁLCULO DINÁMICO DEL FRUSTUM (Ajuste al 100% de pantalla a 4.0 unidades de distancia)
  const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 4.0;
  const visibleWidth = visibleHeight * (window.innerWidth / window.innerHeight);
  const videoGeometry = new THREE.PlaneGeometry(visibleWidth, visibleHeight);
  console.log(`Dynamic frustum size at Z-offset 4.0: ${visibleWidth.toFixed(2)} x ${visibleHeight.toFixed(2)}`);

  // SHADER DE INTEGRACIÓN PARA EL VÍDEO (Fusión suave aditiva con el negro)
  videoMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uVideoTexture: { value: videoTexture },
      uOpacity: { value: 0.0 }
    },
    vertexShader: videoVertexShader,
    fragmentShader: videoFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  videoMesh = new THREE.Mesh(videoGeometry, videoMaterial);
  videoMesh.position.set(0, 0.0, camera.position.z - 4.0);
  scene.add(videoMesh);
  console.log("Video plane mesh loaded at Z:", videoMesh.position.z);

  // CREACIÓN DEL PLANO Y MATERIAL DE BULLET-TIME (Reutilizando shaders)
  bulletMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uVideoTexture: { value: bulletTexture },
      uOpacity: { value: 0.0 }
    },
    vertexShader: videoVertexShader,
    fragmentShader: videoFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const bulletGeometry = new THREE.PlaneGeometry(visibleWidth, visibleHeight);
  bulletMesh = new THREE.Mesh(bulletGeometry, bulletMaterial);
  bulletMesh.position.set(0, 0.0, camera.position.z - 4.0);
  scene.add(bulletMesh);
  console.log("Bullet plane mesh loaded at Z:", bulletMesh.position.z);

  // Generar textura de caracteres (Código Matrix)
  const characterTexture = createCharacterTexture();

  // Crear material de lluvia personalizado con uniforms de hover
  material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uTexture: { value: characterTexture },
        uHoverRed: { value: 0 },
        uHoverBlue: { value: 0 },
        uMatrixOpacity: { value: 1.0 }
      }
    ]),
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true
  });
  console.log("ShaderMaterial created.");

  // 2. ARQUITECTURA DE RENDIMIENTO (InstancedMesh)
  const count = 600;
  const geometry = new THREE.PlaneGeometry(0.12, 5.0);

  const randomData = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    randomData[i * 3 + 0] = Math.random(); // Velocidad
    randomData[i * 3 + 1] = Math.random(); // Desfase temporal
    randomData[i * 3 + 2] = Math.random(); // Ratio de mutación
  }
  geometry.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randomData, 3));

  instancedMesh = new THREE.InstancedMesh(geometry, material, count);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  // Inicializar caché de posiciones de columnas de lluvia en un Float32Array plano
  instancedPositions = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * 16;
    const y = Math.random() * 12 - 2;
    const z = Math.random() * -12;

    instancedPositions[i * 3 + 0] = x;
    instancedPositions[i * 3 + 1] = y;
    instancedPositions[i * 3 + 2] = z;

    position.set(x, y, z);
    quaternion.setFromEuler(rotation);
    matrix.compose(position, quaternion, scale);
    instancedMesh.setMatrixAt(i, matrix);
  }
  
  instancedMesh.instanceMatrix.needsUpdate = true;
  scene.add(instancedMesh);
  console.log("InstancedMesh and cached positions array added.");

  // 4. PIPELINE DE POSTPROCESADO (La Lente)
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomEffect = new BloomEffect({
    intensity: 2.0,
    luminanceThreshold: 0.15,
    luminanceSmoothing: 0.9,
    mipmapBlur: true
  });

  const noiseEffect = new NoiseEffect({
    blendFunction: BlendFunction.SCREEN,
    premultiply: true
  });
  // Si se prefiere movimiento reducido, atenuamos el grano de película
  noiseEffect.blendMode.opacity.value = prefersReducedMotion ? 0.04 : 0.18;

  // Aberración cromática sutil
  const chromaEffect = new ChromaticAberrationEffect({
    offset: prefersReducedMotion ? new THREE.Vector2(0.0002, 0.0002) : new THREE.Vector2(0.0015, 0.0015)
  });

  // Viñeta suave en los bordes de la cámara
  const vignetteEffect = new VignetteEffect({
    eskil: false,
    offset: 0.25,
    darkness: 0.5
  });

  // Profundidad de campo (rack focus) con enfoque dinámico
  dofEffect = new DepthOfFieldEffect(camera, {
    focusDistance: 0.02,
    focalLength: prefersReducedMotion ? 0.01 : 0.05,
    bokehScale: prefersReducedMotion ? 0.5 : 2.0,
    height: 480
  });

  // Asegurar que la cámara se use como referencia inicial de foco
  if (videoMesh) {
    dofEffect.target.copy(videoMesh.position);
  }

  const effectPass = new EffectPass(camera, bloomEffect, noiseEffect, chromaEffect, vignetteEffect, dofEffect);
  composer.addPass(effectPass);

  // Inicializar controladores de interacción
  setupScrollController();
  setupUIEventListeners();

  window.addEventListener('resize', onWindowResize);
  
  console.log("Starting animation loop...");
  animate();
}

// 3. SISTEMA DE SCROLL VIRTUAL CON INERCIA (Habilitado en MATRIX y BULLET_TIME)
function setupScrollController() {
  console.log("Setting up virtual scroll controller...");
  
  window.addEventListener('wheel', (e) => {
    if (appState !== 'MATRIX' && appState !== 'BULLET_TIME') return;
    
    const speed = 0.0008;
    targetScrollProgress = Math.max(0.0, Math.min(1.0, targetScrollProgress + e.deltaY * speed));
  });

  let touchStartY = 0;
  window.addEventListener('touchstart', (e) => {
    if (appState !== 'MATRIX' && appState !== 'BULLET_TIME') return;
    touchStartY = e.touches[0].clientY;
  });

  window.addEventListener('touchmove', (e) => {
    if (appState !== 'MATRIX' && appState !== 'BULLET_TIME') return;
    const touchY = e.touches[0].clientY;
    const deltaY = touchStartY - touchY;
    touchStartY = touchY;

    const speed = 0.0025;
    targetScrollProgress = Math.max(0.0, Math.min(1.0, targetScrollProgress + deltaY * speed));
  });
}

function setupUIEventListeners() {
  const redButton = document.querySelector('.pill-button.red');
  const blueButton = document.querySelector('.pill-button.blue');
  const uiOverlay = document.getElementById('ui-overlay');

  if (redButton && blueButton) {
    console.log("UI Buttons found, attaching listeners...");

    redButton.addEventListener('mouseenter', () => {
      if (interactionsActivated) targetHoverRed = 1.0;
    });
    redButton.addEventListener('mouseleave', () => {
      targetHoverRed = 0.0;
    });

    blueButton.addEventListener('mouseenter', () => {
      if (interactionsActivated) targetHoverBlue = 1.0;
    });
    blueButton.addEventListener('mouseleave', () => {
      targetHoverBlue = 0.0;
    });

    redButton.addEventListener('click', () => {
      if (appState !== 'MATRIX' || !interactionsActivated) return;
      console.log("Red Pill chosen! Transitioning to BULLET_TIME climax...");
      appState = 'BULLET_TIME';

      // Capturar opacidades actuales para lerp
      transitionOpacityMatrix = material ? material.uniforms.uMatrixOpacity.value : 1.0;
      transitionOpacityVideo = videoMaterial ? videoMaterial.uniforms.uOpacity.value : 0.0;
      transitionOpacityBullet = 0.0;

      // Anclar la posición del plano de bullet time a 4 unidades frente a la cámara actual
      if (bulletMesh) {
        bulletMesh.position.set(0, 0, camera.position.z - 4.0);
      }
      if (videoMesh) {
        // se queda estático en su Z actual para crear efecto de punch-through
      }

      // Reproducir bulletVideo de manera robusta
      playBulletVideo();

      if (uiOverlay) {
        uiOverlay.style.opacity = '0';
        uiOverlay.style.pointerEvents = 'none';
      }
    });

    blueButton.addEventListener('click', () => {
      if (appState !== 'MATRIX' || !interactionsActivated) return;
      console.log("Blue Pill chosen! Commencing simulation...");
      appState = 'BLUE_SIM';

      if (uiOverlay) {
        uiOverlay.style.opacity = '0';
        uiOverlay.style.pointerEvents = 'none';
      }

      const blueOverlay = document.getElementById('blue-sim-overlay');
      if (blueOverlay) {
        blueOverlay.style.opacity = '1';
        blueOverlay.style.pointerEvents = 'auto';
        blueOverlay.classList.add('active');
      }
    });

    // Listeners para restablecer la simulación en los overlays de finalización
    document.querySelectorAll('.reset-button').forEach(btn => {
      btn.addEventListener('click', () => {
        resetToMatrix();
      });
    });
  } else {
    console.warn("UI Buttons not found in DOM.");
  }
}

function playBulletVideo() {
  if (!bulletVideo) return;
  const playPromise = bulletVideo.play();
  if (playPromise !== undefined) {
    playPromise.catch(error => {
      console.warn("Bullet video play delayed: waiting for buffer...", error);
      const onCanPlay = () => {
        bulletVideo.play().catch(e => console.error("Error playing bullet video after buffering:", e));
        bulletVideo.removeEventListener('canplaythrough', onCanPlay);
      };
      bulletVideo.addEventListener('canplaythrough', onCanPlay);
    });
  }
}

function resetToMatrix() {
  console.log("Resetting simulation to MATRIX state...");
  appState = 'MATRIX';
  scrollProgress = 0.0;
  targetScrollProgress = 0.0;
  interactionsActivated = false;
  cameraSpeed = 0.002;
  bulletVideoLoaded = false;

  // Restablecer opacidades de transición
  transitionOpacityMatrix = 1.0;
  transitionOpacityVideo = 0.0;
  transitionOpacityBullet = 0.0;

  // Restablecer posición y rotación de la cámara
  camera.position.set(0, 0, 5);
  camera.rotation.set(0, 0, 0);

  // Reiniciar vídeos
  if (video) {
    video.currentTime = 0;
  }
  if (bulletVideo) {
    bulletVideo.pause();
    bulletVideo.currentTime = 0;
  }

  // Restablecer uniforms de los materiales
  if (videoMaterial) {
    videoMaterial.uniforms.uOpacity.value = 0.0;
  }
  if (bulletMaterial) {
    bulletMaterial.uniforms.uOpacity.value = 0.0;
  }
  if (material) {
    material.uniforms.uMatrixOpacity.value = 1.0;
    material.uniforms.uHoverRed.value = 0.0;
    material.uniforms.uHoverBlue.value = 0.0;
  }
  currentHoverRed = 0.0;
  currentHoverBlue = 0.0;
  targetHoverRed = 0.0;
  targetHoverBlue = 0.0;

  // Reposicionar los planos de vídeo en su posición de inicio
  if (videoMesh) {
    videoMesh.position.set(0, 0.0, camera.position.z - 4.0);
    videoMesh.rotation.set(0, 0, 0);
  }
  if (bulletMesh) {
    bulletMesh.position.set(0, 0.0, camera.position.z - 4.0);
    bulletMesh.rotation.set(0, 0, 0);
  }

  // Restablecer foco del dofEffect
  if (dofEffect && videoMesh) {
    dofEffect.target.copy(videoMesh.position);
  }

  // Ocultar overlays
  const uiOverlay = document.getElementById('ui-overlay');
  const blueOverlay = document.getElementById('blue-sim-overlay');
  const redOverlay = document.getElementById('red-end-overlay');

  if (uiOverlay) {
    uiOverlay.style.opacity = '0';
    uiOverlay.style.pointerEvents = 'none';
  }
  if (blueOverlay) {
    blueOverlay.style.opacity = '0';
    blueOverlay.style.pointerEvents = 'none';
    blueOverlay.classList.remove('active');
  }
  if (redOverlay) {
    redOverlay.style.opacity = '0';
    redOverlay.style.pointerEvents = 'none';
    redOverlay.classList.remove('active');
  }
}

// 4. HITO FINAL INTERACTIVO (Las Píldoras)
function activatePillInteractions(isActive) {
  const uiOverlay = document.getElementById('ui-overlay');
  if (!uiOverlay) return;

  if (isActive) {
    if (!interactionsActivated) {
      console.log("activatePillInteractions: Habilitando controles de elección.");
      uiOverlay.style.opacity = '1';
      uiOverlay.style.pointerEvents = 'auto';
      interactionsActivated = true;
    }
  } else {
    // Si rebobina con scroll, ocultar
    if (appState === 'MATRIX' && interactionsActivated) {
      console.log("activatePillInteractions: Deshabilitando controles de elección (scroll invertido).");
      uiOverlay.style.opacity = '0';
      uiOverlay.style.pointerEvents = 'none';
      interactionsActivated = false;
    }
  }
}

function transitionToEndRed() {
  console.log("Transitioning to END_RED state...");
  appState = 'END_RED';

  // Mostrar el overlay rojo final
  const redOverlay = document.getElementById('red-end-overlay');
  if (redOverlay) {
    redOverlay.style.opacity = '1';
    redOverlay.style.pointerEvents = 'auto';
    redOverlay.classList.add('active');
  }
}

function recycleRainColumns() {
  if (instancedMesh && instancedPositions) {
    const tempMatrix = new THREE.Matrix4();
    const tempPosition = new THREE.Vector3();
    const tempQuaternion = new THREE.Quaternion();
    const tempScale = new THREE.Vector3(1, 1, 1);
    let positionsChanged = false;

    for (let i = 0; i < instancedMesh.count; i++) {
      let x = instancedPositions[i * 3 + 0];
      let y = instancedPositions[i * 3 + 1];
      let z = instancedPositions[i * 3 + 2];

      if (z > camera.position.z + 0.5) {
        z = camera.position.z - 12.0;
        x = (Math.random() - 0.5) * 16;
        y = Math.random() * 12 - 2;

        instancedPositions[i * 3 + 0] = x;
        instancedPositions[i * 3 + 1] = y;
        instancedPositions[i * 3 + 2] = z;

        tempPosition.set(x, y, z);
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        instancedMesh.setMatrixAt(i, tempMatrix);
        positionsChanged = true;
      }
    }
    if (positionsChanged) {
      instancedMesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function animate() {
  requestAnimationFrame(animate);

  const elapsedTime = clock.getElapsedTime();

  // Actualizar el tiempo global en el material de lluvia en todo momento
  if (material) {
    material.uniforms.uTime.value = elapsedTime;
  }

  // Rack focus dinámico con DepthOfField
  if (dofEffect) {
    if (appState === 'BULLET_TIME' && bulletMesh) {
      dofEffect.target.copy(bulletMesh.position);
    } else if (videoMesh) {
      dofEffect.target.copy(videoMesh.position);
    }
  }

  if (appState === 'MATRIX') {
    // Calcular suavizado de scroll mediante lerp
    scrollProgress += (targetScrollProgress - scrollProgress) * 0.05;

    // Sincronizar el progreso del vídeo fotograma a fotograma
    if (video && !isNaN(video.duration) && video.duration > 0) {
      video.currentTime = scrollProgress * video.duration;
    }

    // 3. CONTROL DE OPACIDAD AJUSTADO (Fundido encadenado / Cross-fade)
    const videoOpacity = THREE.MathUtils.clamp((scrollProgress - 0.2) / 0.6, 0.0, 1.0);
    const matrixOpacity = THREE.MathUtils.clamp(1.0 - (scrollProgress - 0.2) / 0.65, 0.0, 1.0);

    if (videoMaterial) {
      videoMaterial.uniforms.uOpacity.value = videoOpacity;
    }
    if (material) {
      material.uniforms.uMatrixOpacity.value = matrixOpacity;
    }

    // Precarga cuando scrollProgress > 0.9
    if (scrollProgress > 0.9 && !bulletVideoLoaded) {
      bulletVideo.load();
      bulletVideoLoaded = true;
      console.log("bulletVideo preloaded via load()");
    }

    // Comprobación de hito interactivo (> 0.98)
    if (scrollProgress >= 0.98) {
      activatePillInteractions(true);
    } else {
      activatePillInteractions(false);
    }

    // Lerp de los estados de Hover para los uniforms de la lluvia de código
    currentHoverRed += (targetHoverRed - currentHoverRed) * 0.1;
    currentHoverBlue += (targetHoverBlue - currentHoverBlue) * 0.1;

    if (material) {
      material.uniforms.uHoverRed.value = currentHoverRed;
      material.uniforms.uHoverBlue.value = currentHoverBlue;
    }

    // Dolly de la cámara en Z
    if (!prefersReducedMotion) {
      camera.position.z -= 0.002;
    }
    if (videoMesh) {
      videoMesh.position.z = camera.position.z - 4.0;
    }

    // Reciclado de lluvia
    recycleRainColumns();

  } else if (appState === 'CHOICE_MADE') {
    if (prefersReducedMotion) {
      transitionToBulletTime();
    } else {
      // Aceleración exponencial (atravesamos el plano del vídeo)
      cameraSpeed *= 1.15;
      camera.position.z -= cameraSpeed;

      // Al cruzar el plano (cámara pasa la posición Z estática del plano), transicionar
      if (videoMesh && camera.position.z <= videoMesh.position.z) {
        transitionToBulletTime();
      }
    }
    
    // Reciclado de lluvia
    recycleRainColumns();

  } else if (appState === 'BULLET_TIME') {
    // Lerp de opacidades para la transición fluida
    transitionOpacityMatrix += (0.0 - transitionOpacityMatrix) * 0.05;
    transitionOpacityVideo += (0.0 - transitionOpacityVideo) * 0.05;
    transitionOpacityBullet += (1.0 - transitionOpacityBullet) * 0.05;

    if (material) {
      material.uniforms.uMatrixOpacity.value = transitionOpacityMatrix;
    }
    if (videoMaterial) {
      videoMaterial.uniforms.uOpacity.value = transitionOpacityVideo;
    }
    if (bulletMaterial) {
      bulletMaterial.uniforms.uOpacity.value = transitionOpacityBullet;
    }

    // Leve punch-through de la cámara durante el fundido (se detiene cuando se completa la transición)
    if (!prefersReducedMotion && transitionOpacityBullet < 0.99) {
      camera.position.z -= 0.015;
    }

    // La VideoTexture se actualiza de forma automática con la reproducción de bulletVideo;
    // no se toca currentTime para que se reproduzca de forma fluida.

    // Reciclado de lluvia
    recycleRainColumns();

  } else if (appState === 'BLUE_SIM' || appState === 'END_RED') {
    // En las pantallas de finalización, desvanecemos todo en WebGL
    if (videoMaterial) {
      videoMaterial.uniforms.uOpacity.value = 0.0;
    }
    if (bulletMaterial) {
      bulletMaterial.uniforms.uOpacity.value = 0.0;
    }
    if (material) {
      material.uniforms.uMatrixOpacity.value = 0.0;
    }
  }

  frameCount++;
  if (frameCount % 100 === 0) {
    console.log(`Render loop... State: ${appState}, ScrollProgress: ${scrollProgress.toFixed(3)}, Camera Z: ${camera.position.z.toFixed(3)}`);
  }

  composer.render();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);

  // Recalcular dinámicamente el tamaño del plano de vídeo para que ocupe el 100% de la pantalla a 4.0 unidades
  if (videoMesh) {
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 4.0;
    const visibleWidth = visibleHeight * (window.innerWidth / window.innerHeight);
    
    videoMesh.geometry.dispose(); // Liberar memoria
    videoMesh.geometry = new THREE.PlaneGeometry(visibleWidth, visibleHeight);
    
    if (bulletMesh) {
      bulletMesh.geometry.dispose();
      bulletMesh.geometry = new THREE.PlaneGeometry(visibleWidth, visibleHeight);
    }
    
    console.log(`Recalculated frustum plane size: ${visibleWidth.toFixed(2)} x ${visibleHeight.toFixed(2)}`);
  }

  console.log("Resize triggered. Size:", window.innerWidth, "x", window.innerHeight);
}

init();
