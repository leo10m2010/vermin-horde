import * as THREE from 'three';

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // keep pixel-art edges crisp; no AA on billboard cutouts
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Pixel-art palettes read best undistorted; tone mapping muddies flat colors.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  return renderer;
}

export function createOrthoCamera(viewHeight: number, near: number, far: number): THREE.OrthographicCamera {
  const aspect = window.innerWidth / window.innerHeight;
  const halfH = viewHeight / 2;
  const halfW = halfH * aspect;
  return new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, near, far);
}

export function resizeRenderer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.OrthographicCamera,
  viewHeight: number,
  maxDpr = 2,
): boolean {
  const canvas = renderer.domElement;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const bufferWidth = Math.floor(width * dpr);
  const bufferHeight = Math.floor(height * dpr);
  const needsResize = canvas.width !== bufferWidth || canvas.height !== bufferHeight;

  if (needsResize) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const halfH = viewHeight / 2;
    const halfW = halfH * aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  return needsResize;
}
