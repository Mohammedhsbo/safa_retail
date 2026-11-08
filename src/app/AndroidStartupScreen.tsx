import { useTranslation } from 'react-i18next'
import { Button } from '../shared/components/Button'

type AndroidStartupScreenProps = {
  error?: string
  onRetry?: () => void
}

export function AndroidStartupScreen({ error, onRetry }: AndroidStartupScreenProps) {
  const { t } = useTranslation()

  return (
    <main className="grid min-h-screen place-items-center bg-[var(--surface)] p-6">
      <section
        aria-live="polite"
        className="w-full max-w-lg rounded-3xl border border-[var(--border)] bg-white p-6 text-center shadow-[var(--shadow-card)]"
        role={error ? 'alert' : 'status'}
      >
        <h1 className="text-xl font-black text-[var(--ink)]">{t('android.startupTitle')}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
          {error ?? t('android.starting')}
        </p>
        {error && (
          <>
            <p className="mt-3 text-sm text-red-800">{t('android.startupRecovery')}</p>
            {onRetry && (
              <Button className="mt-5" onClick={onRetry}>
                {t('android.retry')}
              </Button>
            )}
          </>
        )}
      </section>
    </main>
  )
}
