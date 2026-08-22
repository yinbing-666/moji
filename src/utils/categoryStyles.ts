import type { Activity } from '../stores/activityStore'

export interface CategoryVisual {
  label: string
  /** 实色：图表、圆点、徽章文字。深浅主题由 index.css 的 --color-cat-* 接管 */
  color: string
  /** 浅底：徽章背景、色块底，同色相低透明度 */
  soft: string
  /** 图标渐变底（当前无引用） */
  iconBg: string
  /** 图标标识（当前无引用） */
  icon: string
}

/** 分类色相固定，仅在深色主题下提亮；取值见 index.css 的 --color-cat-* */
export const CATEGORY_VISUALS: Record<Activity['category'], CategoryVisual> = {
  dev: {
    label: '开发',
    color: 'var(--color-cat-dev)',
    soft: 'color-mix(in srgb, var(--color-cat-dev) 12%, transparent)',
    iconBg: 'from-indigo-500 to-blue-600',
    icon: 'Dev',
  },
  meeting: {
    label: '会议',
    color: 'var(--color-cat-meeting)',
    soft: 'color-mix(in srgb, var(--color-cat-meeting) 12%, transparent)',
    iconBg: 'from-orange-500 to-red-500',
    icon: 'Meet',
  },
  doc: {
    label: '文档',
    color: 'var(--color-cat-doc)',
    soft: 'color-mix(in srgb, var(--color-cat-doc) 12%, transparent)',
    iconBg: 'from-sky-500 to-blue-600',
    icon: 'Doc',
  },
  communication: {
    label: '沟通',
    color: 'var(--color-cat-communication)',
    soft: 'color-mix(in srgb, var(--color-cat-communication) 12%, transparent)',
    iconBg: 'from-pink-500 to-rose-500',
    icon: 'Chat',
  },
  other: {
    label: '其他',
    color: 'var(--color-cat-other)',
    soft: 'color-mix(in srgb, var(--color-cat-other) 12%, transparent)',
    iconBg: 'from-zinc-400 to-zinc-500',
    icon: 'Other',
  },
  unclassified: {
    label: '未分类',
    color: 'var(--color-cat-unclassified)',
    soft: 'color-mix(in srgb, var(--color-cat-unclassified) 12%, transparent)',
    iconBg: 'from-amber-400 to-amber-600',
    icon: '?',
  },
}

export function categoryVisual(category: Activity['category']): CategoryVisual {
  return CATEGORY_VISUALS[category] ?? CATEGORY_VISUALS.other
}
