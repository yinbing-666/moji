import type { BackgroundPreset, ThemeMode } from '../stores/activityStore'

type ResolvedTheme = Exclude<ThemeMode, 'system'>

interface SkinColors {
  canvas: string
  sidebar: string
}

/**
 * 画布与侧栏配色。约束：canvas 必须比 --color-surface 更暗（深色）或更深（浅色），
 * 否则卡片浮不起来。plain / graphite 走中性墨色，mint / sky 保留刻意的色相偏移。
 */
const SKINS: Record<ResolvedTheme, Record<Exclude<BackgroundPreset, 'custom'>, SkinColors>> = {
  light: {
    plain: {
      canvas: 'linear-gradient(180deg, #f4f6f6 0%, #eef1f1 100%)',
      sidebar: 'rgb(239 242 242 / 0.96)',
    },
    mint: {
      canvas: 'linear-gradient(135deg, #eef6f3 0%, #f3f6f5 55%, #ecf1ef 100%)',
      sidebar: 'rgb(233 243 239 / 0.94)',
    },
    sky: {
      canvas: 'linear-gradient(135deg, #eef3f6 0%, #f3f6f7 55%, #ecf0f2 100%)',
      sidebar: 'rgb(233 240 244 / 0.94)',
    },
    graphite: {
      canvas: 'linear-gradient(135deg, #eff1f1 0%, #f4f5f5 55%, #e8ebeb 100%)',
      sidebar: 'rgb(232 235 235 / 0.95)',
    },
  },
  dark: {
    plain: {
      canvas: 'linear-gradient(180deg, #101315 0%, #0c0f10 100%)',
      sidebar: 'rgb(18 21 23 / 0.96)',
    },
    mint: {
      canvas: 'linear-gradient(135deg, #101917 0%, #0f1414 52%, #0b0f0f 100%)',
      sidebar: 'rgb(17 26 24 / 0.94)',
    },
    sky: {
      canvas: 'linear-gradient(135deg, #101619 0%, #0f1315 52%, #0b0e10 100%)',
      sidebar: 'rgb(17 24 27 / 0.94)',
    },
    graphite: {
      canvas: 'linear-gradient(135deg, #131617 0%, #0f1112 52%, #0c0e0f 100%)',
      sidebar: 'rgb(21 24 25 / 0.94)',
    },
  },
}

function escapeCssString(value: string): string {
  return value.replace(/[\0-\x1f\x7f"\\]/g, (character) => {
    if (character === '\\') {
      return '\\\\'
    }
    if (character === '"') {
      return '\\"'
    }
    if (character === '\0') {
      return '\\FFFD '
    }
    return `\\${character.charCodeAt(0).toString(16)} `
  })
}

function getSafeBackgroundUrl(value: string): string | undefined {
  const trimmed = value.trim()

  if (!trimmed) {
    return undefined
  }

  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return escapeCssString(trimmed)
  }

  try {
    const url = new URL(trimmed)

    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'file:') {
      return undefined
    }

    return escapeCssString(url.href)
  } catch {
    return undefined
  }
}

export function getAppearanceSkin(
  theme: ResolvedTheme,
  preset: BackgroundPreset,
  customBackground?: string,
): SkinColors {
  const safeBackgroundUrl = preset === 'custom' && customBackground
    ? getSafeBackgroundUrl(customBackground)
    : undefined

  if (safeBackgroundUrl) {
    const overlay = theme === 'dark'
      ? 'linear-gradient(rgb(10 13 14 / 0.72), rgb(10 13 14 / 0.72))'
      : 'linear-gradient(rgb(244 246 246 / 0.36), rgb(244 246 246 / 0.36))'
    return {
      canvas: `${overlay}, url("${safeBackgroundUrl}") center / cover fixed`,
      sidebar: theme === 'dark' ? 'rgb(16 19 21 / 0.88)' : 'rgb(240 243 243 / 0.88)',
    }
  }

  return SKINS[theme][preset === 'custom' ? 'plain' : preset]
}

export function getAppearancePreview(
  preset: BackgroundPreset,
  theme: ResolvedTheme,
  customBackground?: string,
): string {
  if (preset === 'custom' && !customBackground) {
    return theme === 'dark'
      ? 'repeating-conic-gradient(#23282b 0% 25%, #15181a 0% 50%) 50% / 10px 10px'
      : 'repeating-conic-gradient(#e7e9e9 0% 25%, #f8f9f9 0% 50%) 50% / 10px 10px'
  }
  return getAppearanceSkin(theme, preset, customBackground).canvas
}