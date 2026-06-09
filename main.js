import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, FilmEffect } from 'postprocessing';

let scene, camera, renderer, composer;

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

  // Pipeline de Postprocesado (La Lente)
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomEffect = new BloomEffect({
    intensity: 1.5,
    luminanceThreshold: 0.2,
    luminanceSmoothing: 0.9,
    mipmapBlur: true
  });

  const filmEffect = new FilmEffect({
    grayscale: false,
    noiseIntensity: 0.15,
    scanlines: false
  });

  const effectPass = new EffectPass(camera, bloomEffect, filmEffect);
  composer.addPass(effectPass);

  window.addEventListener('resize', onWindowResize);
  
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  composer.render();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener('DOMContentLoaded', init);
