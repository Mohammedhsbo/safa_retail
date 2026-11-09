import i18n from './index'

export function formatLocaleDate(value: string | Date, includeTime = false): string {
  return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
  }).format(new Date(value))
}
