import {
  cleanup,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../../app/ui/ErrorBoundary'
import { AppRoutes } from '../../app/routes'
import { LocaleSync } from '../../app/LocaleSync'
import i18n from '../../shared/i18n'
import { resources } from '../../shared/i18n/resources'
import { useAppStore } from '../../shared/state/app-store'

function translationKeys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object'
      ? translationKeys(child, path)
      : [path]
  })
}

function renderApplication(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocaleSync />
      <AppRoutes />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useAppStore.setState({ locale: 'ar' })
  document.documentElement.lang = 'ar'
  document.documentElement.dir = 'rtl'
})

afterEach(async () => {
  cleanup()
  useAppStore.setState({ locale: 'ar' })
  await i18n.changeLanguage('ar')
  document.documentElement.lang = 'ar'
  document.documentElement.dir = 'rtl'
})

describe('application foundation', () => {
  it('provides matching translation keys for Arabic and English', () => {
    expect(translationKeys(resources.ar.translation).sort())
      .toEqual(translationKeys(resources.en.translation).sort())
  })

  it('shows a recovery screen when a route throws during rendering', () => {
    function BrokenView(): never {
      throw new Error('test render failure')
    }

    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <BrokenView />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'حدث خطأ غير متوقع',
    )
  })

  it('rejects unsupported locales without changing the current locale', () => {
    expect(() => useAppStore.getState().setLocale('fr')).toThrow()
    expect(useAppStore.getState().locale).toBe('ar')
  })

  it('renders the online authentication flow with RTL document settings', async () => {
    renderApplication()

    expect(
      screen.getByRole('heading', { name: 'تسجيل الدخول' }),
    ).toBeInTheDocument()
    const languageButton = screen.getByRole('button', { name: 'تغيير لغة التطبيق' })
    expect(languageButton.querySelector('svg')).toBeInTheDocument()
    expect(languageButton).not.toHaveTextContent('English')

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('ar')
      expect(document.documentElement.dir).toBe('rtl')
      expect(document.title).toBe('سفا ريتيل')
    })
  })

  it('switches the interface language and document direction', async () => {
    renderApplication()
    await userEvent.setup().click(
      screen.getByRole('button', { name: 'تغيير لغة التطبيق' }),
    )

    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en')
      expect(document.documentElement.dir).toBe('ltr')
      expect(document.title).toBe('SAFA Retail')
    })
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    const languageButton = screen.getByRole('button', { name: 'Change application language' })
    expect(languageButton.querySelector('svg')).toBeInTheDocument()
    expect(languageButton).not.toHaveTextContent('العربية')
  })

  it('formats dates using the active application language', async () => {
    const { formatLocaleDate } = await import('../../shared/i18n/formatDate')
    await i18n.changeLanguage('ar')
    const arabicDate = formatLocaleDate('2026-11-08T12:00:00Z', true)
    await i18n.changeLanguage('en')
    const englishDate = formatLocaleDate('2026-11-08T12:00:00Z', true)

    expect(arabicDate).not.toBe(englishDate)
    expect(englishDate).toContain('Nov')
  })

  it('keeps the app on the sign-in route when a page is not found before authentication', () => {
    renderApplication('/unknown')

    expect(
      screen.getByRole('heading', { name: 'تسجيل الدخول' }),
    ).toBeInTheDocument()
  })
})
