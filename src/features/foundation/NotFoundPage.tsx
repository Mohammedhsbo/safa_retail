import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getButtonClassName } from '../../shared/components/button-styles'

export function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface)] p-6">
      <section className="max-w-lg text-center">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
          404
        </p>
        <h1 className="mt-4 text-3xl font-extrabold text-[var(--ink)]">
          {t('errors.notFoundTitle')}
        </h1>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          {t('errors.notFoundDescription')}
        </p>
        <Link className={getButtonClassName('primary', 'mt-7')} to="/">
          {t('errors.backHome')}
        </Link>
      </section>
    </main>
  )
}
