import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../shared/state/app-store'

export function LocaleSync() {
  const locale = useAppStore((state) => state.locale)
  const { i18n } = useTranslation()

  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
    document.title = i18n.getFixedT(locale)('app.name')
    void i18n.changeLanguage(locale)
  }, [i18n, locale])

  return null
}
