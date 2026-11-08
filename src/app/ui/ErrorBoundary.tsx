import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportError } from '../../shared/errors/report-error'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, errorInfo.componentStack)
  }

  render() {
    if (this.state.hasError) {
      const isArabic = document.documentElement.lang === 'ar'

      return (
        <main
          className="flex min-h-screen items-center justify-center bg-[var(--surface)] p-6"
          dir={isArabic ? 'rtl' : 'ltr'}
        >
          <section
            aria-live="assertive"
            className="w-full max-w-lg rounded-3xl border border-[var(--border)] bg-white p-8 text-center shadow-[var(--shadow-card)]"
            role="alert"
          >
            <h1 className="text-2xl font-bold text-[var(--ink)]">
              {isArabic ? 'حدث خطأ غير متوقع' : 'Something went wrong'}
            </h1>
            <p className="mt-3 leading-7 text-[var(--muted)]">
              {isArabic
                ? 'تعذر عرض هذه الصفحة. أعد تحميل التطبيق للمتابعة.'
                : 'This page could not be displayed. Reload the app to continue.'}
            </p>
            <button
              className="mt-6 rounded-xl bg-[var(--brand)] px-5 py-3 font-semibold text-white transition hover:bg-[var(--brand-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
              onClick={() => window.location.reload()}
              type="button"
            >
              {isArabic ? 'إعادة تحميل التطبيق' : 'Reload application'}
            </button>
          </section>
        </main>
      )
    }

    return this.props.children
  }
}
