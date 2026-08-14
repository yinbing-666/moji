import { useEffect } from 'react'

interface ScreenshotModalProps {
  base64: string | null
  onClose: () => void
}

export function ScreenshotModal({ base64, onClose }: ScreenshotModalProps) {
  // P1优化: ESC键关闭 + 点击背景关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!base64) return null

  return (
    /* P1优化: Modal容器 - 使用更克制的样式 */
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="截图预览"
    >
      {/* P1优化: Modal内容 - 删除动画 */}
      <div 
        className="relative max-w-2xl w-full rounded-xl bg-white shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭按钮 - 简化样式 */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors shadow-sm"
          aria-label="关闭"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* 图片区域 - 保持原始尺寸比例 */}
        <div className="bg-gray-50">
          <img
            src={`data:image/jpeg;base64,${base64}`}
            alt="活动截图预览"
            className="max-h-[80vh] w-auto mx-auto object-contain"
          />
        </div>

        {/* 底部信息栏 - 简化样式 */}
        <div className="px-4 py-3 border-t border-gray-200 bg-white">
          <p className="text-xs text-gray-500 text-center">
            截图时间: {new Date().toLocaleString('zh-CN')}
          </p>
        </div>
      </div>
    </div>
  )
}
