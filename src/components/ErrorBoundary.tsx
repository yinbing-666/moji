import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[墨记 ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-sunken p-6">
          <div className="max-w-md w-full rounded-xl border border-danger-line bg-surface p-6 shadow-sm">
            {/* P1优化: 错误图标使用SVG替代emoji */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-danger-soft text-danger-ink">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">应用出错</h2>
                <p className="text-sm text-ink-muted mt-0.5">墨记遇到了一个意外错误</p>
              </div>
            </div>

            <div className="mb-4 rounded-md bg-sunken p-3">
              <p className="text-xs font-mono text-danger-ink break-all">
                {this.state.error?.message || '未知错误'}
              </p>
            </div>

            <div className="flex gap-2">
              {/* P1优化: 按钮使用纯色 */}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="flex-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover transition-colors"
              >
                刷新页面
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="flex-1 rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-ink-muted hover:bg-sunken transition-colors"
              >
                重试
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
