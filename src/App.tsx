import { useState } from 'react'
import { ActivityProvider, useActivityStore } from './stores/activityStore'
import { Settings } from './components/Settings'
import { ActivityTimeline } from './components/ActivityTimeline'
import { ReportView } from './components/ReportView'
import { useAutoCapture } from './hooks/useAutoCapture'

function Dashboard() {
  const { isAnalyzing, settings } = useActivityStore()
  const { isRunning, isCapturing, latestScreenshot, error, start, stop } = useAutoCapture()
  const [tab, setTab] = useState<'timeline' | 'report'>('timeline')
  const isConfigured = Boolean(settings.apiKey.trim() && settings.baseUrl.trim())

  const handleCaptureToggle = () => {
    if (isRunning) {
      stop()
      return
    }
    if (isConfigured) {
      start()
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center text-white text-sm font-bold">
              X
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Xiaohei Daily</h1>
              <p className="text-xs text-gray-500">AI work report assistant</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              {isRunning ? (
                <>
                  <span className={`w-2 h-2 rounded-full ${isAnalyzing ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}`} />
                  <span className="text-gray-600">
                    {isAnalyzing ? 'AI analyzing' : isCapturing ? 'Capturing' : 'Running'}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-gray-300" />
                  <span className="text-gray-500">Stopped</span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={handleCaptureToggle}
              disabled={!isRunning && !isConfigured}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isRunning
                  ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isRunning ? 'Stop' : 'Start capture'}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-4xl mx-auto mt-4 px-6">
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        </div>
      )}

      {!isConfigured && (
        <div className="max-w-4xl mx-auto mt-4 px-6">
          <div role="status" className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            Configure API Key and Base URL in Settings before starting capture.
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setTab('timeline')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'timeline' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Activity
          </button>
          <button
            type="button"
            onClick={() => setTab('report')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'report' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Report
          </button>
        </div>

        {tab === 'timeline' ? <ActivityTimeline /> : <ReportView />}
      </main>

      {latestScreenshot && (
        <div className="fixed bottom-4 right-4 w-48 rounded-lg overflow-hidden shadow-lg border border-gray-200 bg-white">
          <img
            src={`data:image/png;base64,${latestScreenshot}`}
            alt="Latest screenshot"
            className="w-full h-auto"
          />
          <div className="px-2 py-1 text-xs text-gray-500 text-center bg-white">
            Latest screenshot
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsPage() {
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-lg font-semibold text-gray-900">Settings</h1>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-6">
        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <Settings />
        </div>
      </main>
    </div>
  )
}

function AppShell() {
  const [page, setPage] = useState<'dashboard' | 'settings'>('dashboard')

  return (
    <>
      <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1 flex gap-1">
        <button
          type="button"
          onClick={() => setPage('dashboard')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            page === 'dashboard' ? 'bg-green-600 text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Dashboard
        </button>
        <button
          type="button"
          onClick={() => setPage('settings')}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            page === 'settings' ? 'bg-green-600 text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Settings
        </button>
      </nav>

      {page === 'dashboard' ? <Dashboard /> : <SettingsPage />}
    </>
  )
}

export default function App() {
  return (
    <ActivityProvider>
      <AppShell />
    </ActivityProvider>
  )
}
