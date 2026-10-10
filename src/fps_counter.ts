let frameCount = 0;
let lastFpsTime = performance.now();

export function tickFps() {
  frameCount++;
  const now = performance.now();
  const elapsed = now - lastFpsTime;

  if (elapsed >= 1000) {
    const fps = (frameCount * 1000) / elapsed;
    console.log(`FPS: ${fps.toFixed(1)}`);
    frameCount = 0;
    lastFpsTime = now;
  }
}