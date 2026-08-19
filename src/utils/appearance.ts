import type { BackgroundPreset, ThemeMode } from '../stores/activityStore'

type ResolvedTheme = Exclude<ThemeMode, 'system'>

interface SkinColors {
  canvas: string
  sidebar: string
}

const SKINS: Record<ResolvedTheme, Record<Exclude<BackgroundPreset, 'custom'>, SkinColors>> = {
  light: {
    plain: {
      canvas: 'linear-gradient(180deg, #f4f7f6 0%, #f1f4f3 100%)',
      sidebar: 'rgb(238 243 241 / 0.96)',
    },
    mint: {
      canvas: 'linear-gradient(135deg, #edf8f4 0%, #f5f8f6 55%, #eef3f1 100%)',
      sidebar: 'rgb(229 242 237 / 0.94)',
    },
    sky: {
      canvas: 'linear-gradient(135deg, #eef5f7 0%, #f6f8f8 55%, #edf2f3 100%)',
      sidebar: 'rgb(230 239 242 / 0.94)',
    },
    graphite: {
      canvas: 'linear-gradient(135deg, #eef1f1 0%, #f6f7f7 55%, #e9edec 100%)',
      sidebar: 'rgb(228 233 232 / 0.95)',
    },
  },
  dark: {
    plain: {
      canvas: 'linear-gradient(180deg, #0e1211 0%, #0b0e0d 100%)',
      sidebar: 'rgb(15 20 18 / 0.96)',
    },
    mint: {
      canvas: 'linear-gradient(135deg, #10201c 0%, #101715 52%, #0b0f0e 100%)',
      sidebar: 'rgb(17 31 27 / 0.94)',
    },
    sky: {
      canvas: 'linear-gradient(135deg, #111c20 0%, #111719 52%, #0c1011 100%)',
      sidebar: 'rgb(18 28 31 / 0.94)',
    },
    graphite: {
      canvas: 'linear-gradient(135deg, #171a19 0%, #111413 52%, #0c0e0d 100%)',
      sidebar: 'rgb(24 28 26 / 0.94)',
    },
  },
}

export function getAppearanceSkin(
  theme: ResolvedTheme,
  preset: BackgroundPreset,
  customBackground?: string,
): SkinColors {
  if (preset === 'custom' && customBackground) {
    const overlay = theme === 'dark'
      ? 'linear-gradient(rgb(9 13 12 / 0.7), rgb(9 13 12 / 0.7))'
      : 'linear-gradient(rgb(244 248 247 / 0.34), rgb(244 248 247 / 0.34))'
    return {
      canvas: `${overlay}, url(${customBackground}) center / cover fixed`,
      sidebar: theme === 'dark' ? 'rgb(14 20 18 / 0.88)' : 'rgb(239 245 243 / 0.88)',
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
      ? 'repeating-conic-gradient(#242a27 0% 25%, #171c1a 0% 50%) 50% / 10px 10px'
      : 'repeating-conic-gradient(#e7ecea 0% 25%, #f8faf9 0% 50%) 50% / 10px 10px'
  }
  return getAppearanceSkin(theme, preset, customBackground).canvas
}
