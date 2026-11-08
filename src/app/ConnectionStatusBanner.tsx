import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function ConnectionStatusBanner() {
  const { t } = useTranslation()
  const [connected, setConnected] = useState(true)

  useEffect(() => {
    if (!connected) {
      toast.error(t('common.connectionLost'), { id: 'connection-lost' })
    } else {
      toast.dismiss('connection-lost')
    }
  }, [connected, t])

  useEffect(() => {
    const handleConnectivity = (event: Event): void => {
      const detail = (event as CustomEvent<{ connected: boolean }>).detail
      setConnected(detail.connected)
    }
    window.addEventListener('safa:connectivity', handleConnectivity)
    return () => window.removeEventListener('safa:connectivity', handleConnectivity)
  }, [])

  if (connected) return null
  return (
    <div className="fixed inset-x-0 top-0 z-[100] bg-red-700 px-4 py-2 text-center text-sm font-bold text-white" role="alert">
      {t('common.connectionLost')}
    </div>
  )
}
