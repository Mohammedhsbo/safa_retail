import { toast } from 'sonner'
import i18n from '../i18n'

export function reportError(error: unknown, context?: string | null) {
  console.error('[SAFA Retail]', error, context)
  toast.error(i18n.t('errors.unexpected'))
}
