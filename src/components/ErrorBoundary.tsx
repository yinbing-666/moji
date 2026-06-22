import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-gray-50 p-8">
          <h1 className="text-2xl font-bold text-red-600 mb-4">⚠️ 应用出错了</h1>
          <pre className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 overflow-auto">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload() }}
            className="mt-4 px-4 py-2 bg-gray-200 rounded-lg text-sm hover:bg-gray-300"
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
