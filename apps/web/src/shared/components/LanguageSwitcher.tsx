import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { useAppStore } from '../state/app-store'

export function LanguageSwitcher() {
  const { t } = useTranslation()
  const locale = useAppStore((state) => state.locale)
  const setLocale = useAppStore((state) => state.setLocale)
  const nextLocale = locale === 'ar' ? 'en' : 'ar'

  return (
    <Button
      aria-label={t('common.switchLanguage')}
      className="size-11 !px-0 !py-0"
      onClick={() => setLocale(nextLocale)}
      variant="secondary"
      title={t('common.switchLanguage')}
    >
      <Globe aria-hidden="true" size={19} />
    </Button>
  )
}
