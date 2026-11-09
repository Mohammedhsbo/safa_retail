import { create } from 'zustand'
import { localeSchema, type Locale } from '../validation/locale'

interface AppState {
  locale: Locale
  setLocale: (locale: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  locale: 'ar',
  setLocale: (locale) => set({ locale: localeSchema.parse(locale) }),
}))
