import type { Activity } from '../stores/activityStore'

export interface CategoryVisual {
  label: string
  /** 徽章/文字色 */
  badge: string
  /** 实心圆点色 */
  dot: string
  /** 图表/时间轴用十六进制色 */
  hex: string
  /** 图标渐变底 */
  iconBg: string
  /** 图标标识（去AI味优化：用英文缩写替代emoji） */
  icon: string
}

/** 去AI味优化：使用低饱和度莫兰迪色系，避免标准彩虹色 */
export const CATEGORY_VISUALS: Record<Activity['category'], CategoryVisual> = {
  dev: {
    label: '开发',
    badge: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
    dot: 'bg-indigo-500',
    hex: '#6366f1',           // 靛蓝色，更科技感
    iconBg: 'from-indigo-500 to-blue-600',
    icon: 'Dev',              // 用英文替代emoji 💻
  },
  meeting: {
    label: '会议',
    badge: 'bg-orange-50 text-orange-700 ring-orange-100',
    dot: 'bg-orange-500',
    hex: '#ea580c',           // 深橙色，更醒目但不刺眼
    iconBg: 'from-orange-500 to-red-500',
    icon: 'Meet',             // 用英文替代emoji 🎥
  },
  doc: {
    label: '文档',
    badge: 'bg-teal-50 text-teal-700 ring-teal-100',
    dot: 'bg-teal-500',
    hex: '#0d9488',           // 与品牌色系协调
    iconBg: 'from-teal-500 to-cyan-600',
    icon: 'Doc',              // 用英文替代emoji 📄
  },
  communication: {
    label: '沟通',
    badge: 'bg-pink-50 text-pink-700 ring-pink-100',
    dot: 'bg-pink-500',
    hex: '#ec4899',           // 玫红色，区分度高
    iconBg: 'from-pink-500 to-rose-500',
    icon: 'Chat',             // 用英文替代emoji 💬
  },
  other: {
    label: '其他',
    badge: 'bg-zinc-50 text-zinc-600 ring-zinc-100',
    dot: 'bg-zinc-400',
    hex: '#71717a',           // 中性灰，不抢眼
    iconBg: 'from-zinc-400 to-zinc-500',
    icon: 'Other',            // 用英文替代emoji 🧩
  },
}

export function categoryVisual(category: Activity['category']): CategoryVisual {
  return CATEGORY_VISUALS[category] ?? CATEGORY_VISUALS.other
}
