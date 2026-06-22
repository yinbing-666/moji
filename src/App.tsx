import { useState } from 'react'
import { takeScreenshot } from './utils/screenshot'

function App() {
  const [base64, setBase64] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleScreenshot = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await takeScreenshot()
      setBase64(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-4">小黑日报助手</h1>
      <p className="text-gray-500 mb-6">AI 自动工作日报生成工具</p>
      
      <button
        onClick={handleScreenshot}
        disabled={loading}
        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? '截屏中...' : '测试截屏'}
      </button>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          错误: {error}
        </div>
      )}

      {base64 && (
        <div className="mt-4">
          <p className="text-sm text-gray-500 mb-2">截屏成功！（{Math.round(base64.length / 1024)} KB）</p>
          <img 
            src={`data:image/png;base64,${base64}`} 
            alt="截屏" 
            className="max-w-full border rounded-lg shadow-lg"
          />
        </div>
      )}
    </div>
  )
}

export default App
