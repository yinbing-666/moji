export interface ContextSignalOptions {
  browserDomains: boolean
  ideProjects: boolean
}

export interface ActivityContextSignals {
  browserDomain?: string
  ideProject?: string
}

const BROWSER_PROCESSES = [
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'brave.exe',
  'opera.exe',
  'vivaldi.exe',
  'arc.exe',
]

const IDE_PROCESSES = [
  'code.exe',
  'cursor.exe',
  'windsurf.exe',
  'devenv.exe',
  'idea64.exe',
  'pycharm64.exe',
  'webstorm64.exe',
  'rider64.exe',
  'clion64.exe',
  'goland64.exe',
]

const IDE_PRODUCT_NAMES = /^(visual studio code|cursor|windsurf|visual studio|intellij idea|pycharm|webstorm|rider|clion|goland)$/i
const FILE_NAME_PATTERN = /\.[a-z0-9]{1,8}$/i

function normalizedProcess(processName: string): string {
  return processName.trim().toLowerCase()
}

function cleanDomain(value: string): string | undefined {
  try {
    const domain = new URL(value).hostname.toLowerCase().replace(/^www\./, '')
    return domain && domain.includes('.') ? domain.slice(0, 120) : undefined
  } catch {
    return undefined
  }
}

export function extractBrowserDomain(processName: string, title: string, windowText: string): string | undefined {
  if (!BROWSER_PROCESSES.includes(normalizedProcess(processName))) return undefined
  const combined = `${windowText}\n${title}`
  const urls = combined.match(/https?:\/\/[^\s<>"'）)]+/gi) ?? []
  for (const url of urls) {
    const domain = cleanDomain(url)
    if (domain) return domain
  }
  return undefined
}

function cleanProjectCandidate(value: string): string | undefined {
  const candidate = value
    .replace(/^\[|\]$/g, '')
    .replace(/^workspace:\s*/i, '')
    .trim()
  if (!candidate || candidate.length > 80 || IDE_PRODUCT_NAMES.test(candidate)) return undefined
  if (FILE_NAME_PATTERN.test(candidate) || /^[a-z]:\\/i.test(candidate)) return undefined
  return candidate
}

export function extractIdeProject(processName: string, title: string): string | undefined {
  const process = normalizedProcess(processName)
  if (!IDE_PROCESSES.includes(process)) return undefined

  const bracketed = title.match(/\[([^\]]{1,80})\]/g) ?? []
  for (const value of bracketed.reverse()) {
    const project = cleanProjectCandidate(value)
    if (project) return project
  }

  const parts = title.split(/\s+[—–-]\s+/).map(part => part.trim()).filter(Boolean)
  while (parts.length > 0 && IDE_PRODUCT_NAMES.test(parts[parts.length - 1])) parts.pop()
  const ordered = process === 'devenv.exe' ? parts : [...parts].reverse()
  for (const part of ordered) {
    const project = cleanProjectCandidate(part)
    if (project) return project
  }
  return undefined
}

export function extractActivityContext(
  processName: string,
  title: string,
  windowText: string,
  options: ContextSignalOptions,
): ActivityContextSignals {
  return {
    ...(options.browserDomains ? { browserDomain: extractBrowserDomain(processName, title, windowText) } : {}),
    ...(options.ideProjects ? { ideProject: extractIdeProject(processName, title) } : {}),
  }
}
