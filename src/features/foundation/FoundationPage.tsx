import { ArrowDownLeft, Check, Layers3, ShieldCheck, WifiOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '../../shared/components/LanguageSwitcher'
import { Card } from '../../shared/components/Card'

const foundationItems = [
  { key: 'routing', icon: Layers3 },
  { key: 'validation', icon: ShieldCheck },
  { key: 'accessibility', icon: Check },
] as const

export function FoundationPage() {
  const { t } = useTranslation()

  return (
    <main className="min-h-screen overflow-hidden bg-[var(--surface)] px-5 py-6 sm:px-8 lg:px-12">
      <header className="mx-auto flex max-w-6xl items-center justify-between">
        <a
          aria-label={t('app.name')}
          className="inline-flex items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--brand)]"
          href="/"
        >
          <span className="grid size-11 place-items-center rounded-2xl bg-[var(--brand)] text-lg font-black text-white shadow-[var(--shadow-brand)]">
            س
          </span>
          <span className="text-lg font-extrabold tracking-tight text-[var(--ink)]">
            {t('app.name')}
          </span>
        </a>

        <LanguageSwitcher />
      </header>

      <section className="mx-auto grid min-h-[calc(100svh-6rem)] max-w-6xl items-center gap-12 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
        <div className="animate-fade-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-border)] bg-[var(--brand-wash)] px-4 py-2 text-sm font-semibold text-[var(--brand)]">
            <WifiOff aria-hidden="true" size={16} />
            <span>{t('foundation.offlineReady')}</span>
          </div>

          <h1 className="mt-7 max-w-2xl text-4xl font-black leading-[1.3] tracking-tight text-[var(--ink)] sm:text-5xl lg:text-6xl">
            {t('foundation.title')}
            <span className="mt-2 block text-[var(--brand)]">
              {t('foundation.titleAccent')}
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-8 text-[var(--muted)] sm:text-lg">
            {t('foundation.description')}
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3 text-sm font-medium text-[var(--muted)]">
            <span className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 shadow-[var(--shadow-soft)]">
              <span className="size-2 rounded-full bg-[var(--brand)]" />
              {t('foundation.phaseLabel')}
            </span>
            <span className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 shadow-[var(--shadow-soft)]">
              <span className="size-2 rounded-full bg-[var(--accent)]" />
              {t('foundation.phaseName')}
            </span>
          </div>
        </div>

        <Card className="relative mx-auto w-full max-w-xl overflow-hidden p-6 sm:p-9">
          <div
            aria-hidden="true"
            className="absolute -end-24 -top-28 size-64 rounded-full bg-[var(--brand-wash)] blur-2xl"
          />
          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-[var(--brand)]">
                  {t('foundation.panelEyebrow')}
                </p>
                <h2 className="mt-2 text-2xl font-extrabold text-[var(--ink)]">
                  {t('foundation.panelTitle')}
                </h2>
              </div>
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[var(--brand)] text-white shadow-[var(--shadow-brand)]">
                <Layers3 aria-hidden="true" size={22} />
              </span>
            </div>

            <p className="mt-4 leading-7 text-[var(--muted)]">
              {t('foundation.panelDescription')}
            </p>

            <ul className="mt-7 space-y-3">
              {foundationItems.map(({ key, icon: Icon }) => (
                <li
                  className="flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-white/80 p-4"
                  key={key}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-wash)] text-[var(--brand)]">
                    <Icon aria-hidden="true" size={19} />
                  </span>
                  <span className="font-semibold text-[var(--ink)]">
                    {t(`foundation.items.${key}`)}
                  </span>
                  <Check
                    aria-hidden="true"
                    className="ms-auto text-[var(--brand)]"
                    size={18}
                  />
                </li>
              ))}
            </ul>

            <div className="mt-7 flex items-center justify-between border-t border-[var(--border)] pt-5 text-sm text-[var(--muted)]">
              <span>{t('foundation.footer')}</span>
              <ArrowDownLeft
                aria-hidden="true"
                className="text-[var(--brand)]"
                size={18}
              />
            </div>
          </div>
        </Card>
      </section>
    </main>
  )
}
