export function calculateActiveDurationSeconds(elapsedSeconds: number, idleSeconds: number): number {
  const elapsed = Math.max(0, Math.round(elapsedSeconds))
  const idle = Math.max(0, Math.round(idleSeconds))
  return Math.max(0, elapsed - Math.min(idle, elapsed))
}
