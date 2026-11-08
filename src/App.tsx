import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { LocaleSync } from './app/LocaleSync'
import { AppRoutes } from './app/routes'
import { ConnectionStatusBanner } from './app/ConnectionStatusBanner'
import type { RetailApplicationServices } from './app/RetailApplicationServices'
import { ConfirmDialogProvider } from './shared/components/ConfirmDialog'

function App({
  services,
  initialSetupRequired = false,
}: {
  services: RetailApplicationServices
  initialSetupRequired?: boolean
}) {
  return (
    <BrowserRouter>
      <LocaleSync />
      <ConnectionStatusBanner />
      <ConfirmDialogProvider>
        <AppRoutes
          initialSetupRequired={initialSetupRequired}
          services={services}
        />
      </ConfirmDialogProvider>
      <Toaster position="top-center" richColors />
    </BrowserRouter>
  )
}

export default App
