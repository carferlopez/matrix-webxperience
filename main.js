import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, NoiseEffect, BlendFunction } from 'postprocessing';

let scene, camera, renderer, composer;
let material, clock;

// 1. GENERADOR DE TEXTURAS PROCEDIMENTAL
function createCharacterTexture() {
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
    // Centrar cada glifo verticalmente en su celda de 64x64 px
    ctx.fillText(char, 32, i * 64 + 32);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
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

    // Mutación del carácter basada en tiempo y ratio de mutación
    float mutationSpeed = 3.0 + vRandom.z * 12.0;
    float timeStep = floor(uTime * mutationSpeed + random(vec2(cellY, vRandom.y)) * 100.0);
    float glyphRand = random(vec2(cellY, timeStep));
    float glyphIdx = floor(glyphRand * 16.0);

    // Mapeo en el atlas de textura vertical (16 caracteres)
    // El glifo 0 está al inicio del canvas (arriba), mapeado a V=1.0.
    vec2 uvAtlas = vec2(localU, (15.0 - glyphIdx + localV) / 16.0);
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

    // Mezcla cromática: cola verde fósforo y cabeza blanca incandescente
    vec3 greenColor = vec3(0.0, 0.9, 0.2);
    vec3 whiteColor = vec3(0.85, 1.0, 0.9);
    vec3 finalColor = mix(greenColor, whiteColor, headGlow * 0.85);

    gl_FragColor = vec4(finalColor * intensity * charTex, intensity * charTex);

    // Aplicar niebla nativa
    #include <fog_fragment>
  }
`;

function init() {
  // Escena y Niebla para volumen
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.015);

  // Cámara Cinematográfica
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 5;

  // Renderer de alto rendimiento
  renderer = new WebGLRenderer();
  
  function WebGLRenderer() {
    const canvasElement = document.querySelector('#matrix-canvas');
    const instance = new THREE.WebGLRenderer({
      canvas: canvasElement,
      antialias: false,
      powerPreference: "high-performance"
    });
    return instance;
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Inicializar reloj
  clock = new THREE.Clock();

  // Generar textura de caracteres
  const characterTexture = createCharacterTexture();

  // Crear material personalizado
  material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uTexture: { value: characterTexture }
    },
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true
  });

  // 2. ARQUITECTURA DE RENDIMIENTO (InstancedMesh)
  const count = 600;
  const geometry = new THREE.PlaneGeometry(0.12, 5.0);

  // Atributos de instancia personalizados
  const randomData = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    randomData[i * 3 + 0] = Math.random(); // Velocidad
    randomData[i * 3 + 1] = Math.random(); // Desfase temporal
    randomData[i * 3 + 2] = Math.random(); // Ratio de mutación
  }
  geometry.setAttribute('aRandom', new THREE.InstancedBufferAttribute(randomData, 3));

  const instancedMesh = new THREE.InstancedMesh(geometry, material, count);

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
  scene.add(instancedMesh);

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

  window.addEventListener('resize', onWindowResize);
  
  animate();
}

function animate() {
  requestAnimationFrame(animate);

  // Pasar el tiempo de ejecución al Shader
  if (material) {
    material.uniforms.uTime.value = clock.getElapsedTime();
  }

  composer.render();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('DOMContentLoaded', init);
