import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

type ConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  destructive?: boolean
}

type PendingConfirmation = ConfirmOptions & {
  resolve: (confirmed: boolean) => void
}

const ConfirmDialogContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null)

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const pendingRef = useRef<PendingConfirmation | null>(null)

  const finish = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed)
    pendingRef.current = null
    setPending(null)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    if (pendingRef.current) {
      pendingRef.current.resolve(false)
    }
    const request = { ...options, resolve }
    pendingRef.current = request
    setPending(request)
  }), [])

  useEffect(() => {
    if (!pending) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [finish, pending])

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[200] grid place-items-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) finish(false)
          }}
        >
          <section
            aria-labelledby="confirm-dialog-title"
            aria-modal="true"
            className="my-auto w-full max-w-md overflow-hidden rounded-3xl border border-white/60 bg-white shadow-[0_30px_90px_-25px_rgba(8,28,21,0.5)]"
            role="alertdialog"
          >
            <header className="flex items-start gap-3 p-5 sm:p-6">
              <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${pending.destructive ? 'bg-red-50 text-red-700' : 'bg-[var(--brand-wash)] text-[var(--brand)]'}`}>
                <AlertTriangle aria-hidden="true" size={21} />
              </span>
              <div>
                <h2 className="font-black text-[var(--ink)]" id="confirm-dialog-title">
                  {pending.title ?? t('common.confirmation')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{pending.message}</p>
              </div>
            </header>
            <footer className="flex flex-col-reverse gap-2 border-t border-[var(--border)] bg-[var(--surface)] p-4 sm:flex-row sm:justify-end">
              <Button onClick={() => finish(false)} variant="secondary">
                {t('common.cancel')}
              </Button>
              <Button
                className={pending.destructive ? 'bg-red-700 hover:bg-red-800' : ''}
                onClick={() => finish(true)}
              >
                {pending.confirmLabel ?? t('common.confirm')}
              </Button>
            </footer>
          </section>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  )
}

export function useConfirmDialog() {
  const confirm = useContext(ConfirmDialogContext)
  if (!confirm) throw new Error('useConfirmDialog must be used within ConfirmDialogProvider')
  return confirm
}
