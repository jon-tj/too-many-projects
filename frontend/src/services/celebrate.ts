import { TaskPriority } from './models';

/**
 * Confetti for finishing a high or critical task; critical gets a bigger burst. Low tasks get nothing.
 * `origin` is the screen point to burst from (defaults to the middle). The library loads on first use, and nothing
 * fires for people who prefer reduced motion.
 */
export async function celebrateDone(priority: TaskPriority, origin?: { x: number; y: number }): Promise<void> {
  if (priority === 'low') return;
  const { default: confetti } = await import('canvas-confetti');
  const point = origin
    ? { x: origin.x / window.innerWidth, y: origin.y / window.innerHeight }
    : { x: 0.5, y: 0.6 };
  const options = { origin: point, disableForReducedMotion: true, zIndex: 1000 };
  if (priority === 'high') {
    void confetti({ ...options, particleCount: 80, spread: 70, startVelocity: 35 });
    return;
  }
  // Critical: a wide burst, then two side bursts a moment later.
  void confetti({ ...options, particleCount: 160, spread: 100, startVelocity: 45 });
  setTimeout(() => {
    void confetti({ ...options, particleCount: 60, angle: 60, spread: 60 });
    void confetti({ ...options, particleCount: 60, angle: 120, spread: 60 });
  }, 200);
}
