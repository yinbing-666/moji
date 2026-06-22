import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          小黑日报助手
        </h1>
        <p className="text-gray-500 mb-6">AI 自动工作日报生成工具</p>
        <button
          onClick={() => setCount(c => c + 1)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          点击测试 ({count})
        </button>
      </div>
    </div>
  )
}

export default App
