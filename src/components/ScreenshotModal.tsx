import { useEffect, useCallback } from 'react'

interface Props {
  base64: string
  onClose: () => void
}

export function ScreenshotModal({ base64, onClose }: Props) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-600 hover:text-gray-900 text-sm font-bold"
        >
          ✕
        </button>
        <img
          src={`data:image/png;base64,${base64}`}
          alt="截屏预览"
          className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
        />
      </div>
    </div>
  )
}
