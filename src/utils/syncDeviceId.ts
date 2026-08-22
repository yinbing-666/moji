export function createSyncDeviceId(randomUuid?: () => string): string {
  const source = randomUuid?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  const suffix = source.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)
  return `device-${suffix || Date.now().toString(36)}`
}

export function resolveSyncDeviceId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized && normalized !== 'device' ? normalized : fallback
}
