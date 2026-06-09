import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, NoiseEffect, BlendFunction } from 'postprocessing';

let scene, camera, renderer, composer;
let material, clock;
let instancedMesh;
let appState = 'MATRIX'; // MATRIX, CHOICE_MADE, GLITCH_OUT

// Variables para el control de vídeo y scroll virtual
let video, videoTexture, videoMaterial, videoMesh;
let scrollProgress = 0.0;
let targetScrollProgress = 0.0;

// Variables para la interacción y animación cinematográfica
let targetHoverRed = 0.0;
let targetHoverBlue = 0.0;
let currentHoverRed = 0.0;
let currentHoverBlue = 0.0;
let cameraSpeed = 0.002;
let frameCount = 0;

console.log("main.js loaded");

// 1. GENERADOR DE TEXTURAS PROCEDIMENTAL
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

// 3. SHADERS NATIVOS PERSONALIZADOS (GLSL)
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

    gl_FragColor = vec4(finalColor * intensity * charTex, intensity * charTex);

    // Aplicar niebla nativa
    #include <fog_fragment>
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

  // 2. CONFIGURACIÓN DEL MOTOR DE VÍDEO
  video = document.getElementById('morpheus-video');
  if (video) {
    console.log("HTML video element found.");
    // Forzar carga de metadatos de forma segura
    video.load();

    videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;

    // Plano centrado ligeramente detrás de la lluvia de código frontal
    const videoGeometry = new THREE.PlaneGeometry(3.2, 1.8);
    videoMaterial = new THREE.MeshBasicMaterial({
      map: videoTexture,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    videoMesh = new THREE.Mesh(videoGeometry, videoMaterial);
    // Posición inicial relativa a la cámara
    videoMesh.position.set(0, 0.0, camera.position.z - 6.5);
    scene.add(videoMesh);
    console.log("Video plane mesh added to scene.");
  } else {
    console.error("Video element #morpheus-video not found in HTML!");
  }

  // Generar textura de caracteres
  const characterTexture = createCharacterTexture();

  // Crear material personalizado con uniforms de hover
  material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uTexture: { value: characterTexture },
        uHoverRed: { value: 0 },
        uHoverBlue: { value: 0 }
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

  for (let i = 0; i < count; i++) {
    // Distribución espacial en caja 3D (X: -8 a 8, Y: -2 a 10, Z: -12 a 0)
    position.set(
      (Math.random() - 0.5) * 16,
      Math.random() * 12 - 2,
      Math.random() * -12
    );

    quaternion.setFromEuler(rotation);
    matrix.compose(position, quaternion, scale);
    instancedMesh.setMatrixAt(i, matrix);
  }
  
  instancedMesh.instanceMatrix.needsUpdate = true;
  scene.add(instancedMesh);
  console.log("InstancedMesh added.");

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
  noiseEffect.blendMode.opacity.value = 0.18;

  const effectPass = new EffectPass(camera, bloomEffect, noiseEffect);
  composer.addPass(effectPass);

  // Inicializar controladores de interacción
  setupScrollController();
  setupUIEventListeners();

  window.addEventListener('resize', onWindowResize);
  
  console.log("Starting animation loop...");
  animate();
}

function setupScrollController() {
  console.log("Setting up virtual scroll controller...");
  
  window.addEventListener('wheel', (e) => {
    if (appState !== 'MATRIX') return;
    
    // Sensibilidad del scroll
    const speed = 0.0008;
    targetScrollProgress = Math.max(0.0, Math.min(1.0, targetScrollProgress + e.deltaY * speed));
  });

  let touchStartY = 0;
  window.addEventListener('touchstart', (e) => {
    if (appState !== 'MATRIX') return;
    touchStartY = e.touches[0].clientY;
  });

  window.addEventListener('touchmove', (e) => {
    if (appState !== 'MATRIX') return;
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

    // Hover píldora roja (Glitch y virado a rojo)
    redButton.addEventListener('mouseenter', () => targetHoverRed = 1.0);
    redButton.addEventListener('mouseleave', () => targetHoverRed = 0.0);

    // Hover píldora azul (Virado a azul)
    blueButton.addEventListener('mouseenter', () => targetHoverBlue = 1.0);
    blueButton.addEventListener('mouseleave', () => targetHoverBlue = 0.0);

    // Click Píldora Roja: Despertar en el mundo real
    redButton.addEventListener('click', () => {
      if (appState !== 'MATRIX') return;
      console.log("Red Pill chosen!");
      appState = 'CHOICE_MADE';
      cameraSpeed = 0.002;

      if (uiOverlay) {
        uiOverlay.style.opacity = '0';
        uiOverlay.style.pointerEvents = 'none';
      }
    });

    // Click Píldora Azul: Volver a la matriz (Glitch masivo y redirección)
    blueButton.addEventListener('click', () => {
      if (appState !== 'MATRIX') return;
      console.log("Blue Pill chosen!");
      appState = 'GLITCH_OUT';

      // Disparar glitch máximo
      targetHoverBlue = 15.0;
      currentHoverBlue = 15.0;
      material.uniforms.uHoverBlue.value = 15.0;

      if (uiOverlay) {
        uiOverlay.style.opacity = '0';
        uiOverlay.style.pointerEvents = 'none';
      }

      setTimeout(() => {
        window.location.href = 'https://www.google.com';
      }, 1000);
    });
  } else {
    console.warn("UI Buttons not found in DOM.");
  }
}

function animate() {
  requestAnimationFrame(animate);

  let elapsedTime = clock.getElapsedTime();

  if (appState === 'GLITCH_OUT') {
    // Congelar reloj (congelar uTime)
    elapsedTime = clock.elapsedTime; 
  } else {
    // 3. CONTROL POR SCROLL VIRTUAL SINCRONIZADO
    scrollProgress += (targetScrollProgress - scrollProgress) * 0.05;

    // Sincronizar el progreso del vídeo (currentTime) de forma matemática
    if (video && !isNaN(video.duration) && video.duration > 0) {
      video.currentTime = scrollProgress * video.duration;
    }

    // Lerp de opacidad del vídeo: 0.0 en scroll 0.0, opaco 1.0 en scroll 0.8
    if (videoMaterial) {
      videoMaterial.opacity = Math.min(1.0, scrollProgress / 0.8);
    }

    // 4. HITO FINAL INTERACTIVO (Las Píldoras)
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && appState === 'MATRIX') {
      if (scrollProgress >= 0.95) {
        uiOverlay.style.opacity = '1';
        uiOverlay.style.pointerEvents = 'auto';
      } else {
        uiOverlay.style.opacity = '0';
        uiOverlay.style.pointerEvents = 'none';
      }
    }

    // Lerp suave de los estados de Hover para los uniforms
    currentHoverRed += (targetHoverRed - currentHoverRed) * 0.1;
    currentHoverBlue += (targetHoverBlue - currentHoverBlue) * 0.1;

    if (material) {
      material.uniforms.uHoverRed.value = currentHoverRed;
      material.uniforms.uHoverBlue.value = currentHoverBlue;
      material.uniforms.uTime.value = elapsedTime;
    }

    // Animaciones de cámara y vídeo según el estado
    if (appState === 'MATRIX') {
      // Dolly-in lento e infinito
      camera.position.z -= 0.002;
      
      // Anclar el plano de vídeo a una distancia fija en Z respecto a la cámara
      // Esto mantiene el encuadre del vídeo mientras el código vuela de fondo
      if (videoMesh) {
        videoMesh.position.z = camera.position.z - 6.5;
      }
    } else if (appState === 'CHOICE_MADE') {
      // Aceleración exponencial (atravesamos el plano del vídeo)
      cameraSpeed *= 1.15;
      camera.position.z -= cameraSpeed;
    }

    // Reciclado infinito de columnas en Z
    if (instancedMesh) {
      const tempMatrix = new THREE.Matrix4();
      const tempPosition = new THREE.Vector3();
      const tempQuaternion = new THREE.Quaternion();
      const tempScale = new THREE.Vector3();

      for (let i = 0; i < instancedMesh.count; i++) {
        instancedMesh.getMatrixAt(i, tempMatrix);
        tempMatrix.decompose(tempPosition, tempQuaternion, tempScale);

        // Si la columna pasa por detrás de la cámara
        if (tempPosition.z > camera.position.z + 0.5) {
          // Reposicionar al fondo en Z relativo a la cámara
          tempPosition.z = camera.position.z - 12.0;
          tempPosition.x = (Math.random() - 0.5) * 16;
          tempPosition.y = Math.random() * 12 - 2;

          tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
          instancedMesh.setMatrixAt(i, tempMatrix);
        }
      }
      instancedMesh.instanceMatrix.needsUpdate = true;
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
  console.log("Resize triggered. Size:", window.innerWidth, "x", window.innerHeight);
}

init();
