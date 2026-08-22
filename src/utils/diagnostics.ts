export interface DiagnosticEntry {
  timestamp: string
  source: string
  level: 'error' | 'warning'
  message: string
}

const MAX_ENTRIES = 50
const entries: DiagnosticEntry[] = []

export function sanitizeDiagnosticMessage(value: unknown): string {
  const message = value instanceof Error ? `${value.name}: ${value.message}` : String(value)
  return message
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/gi, '[api-key]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[redacted]')
    .replace(/([?&](?:key|token|api_key|access_token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\s]*/g, '[local-path]')
    .slice(0, 500)
}

export function recordDiagnostic(source: string, value: unknown, level: DiagnosticEntry['level'] = 'error') {
  entries.unshift({
    timestamp: new Date().toISOString(),
    source,
    level,
    message: sanitizeDiagnosticMessage(value),
  })
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES
}

export function getDiagnostics(): DiagnosticEntry[] {
  return entries.map(entry => ({ ...entry }))
}
