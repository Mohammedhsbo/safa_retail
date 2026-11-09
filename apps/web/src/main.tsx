import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { ApiClient } from '@safa/api-client'
import i18n from './shared/i18n'
import './styles/index.css'
import App from './App.tsx'
import { reportError } from './shared/errors/report-error'
import { AndroidStartupScreen } from './app/AndroidStartupScreen'
import { createOnlineApplicationServices } from './app/RetailApplicationServices'
import { useWorkspaceStore } from './shared/state/workspace-store'

window.addEventListener('error', (event) => {
  reportError(event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason)
})

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Missing application root element')
}

const root = createRoot(rootElement)
const render = (content: ReactNode): void => {
  root.render(<StrictMode>{content}</StrictMode>)
}

const platform = Capacitor.getPlatform()
if (Capacitor.isNativePlatform() && platform !== 'android') {
  render(<AndroidStartupScreen error={i18n.t('android.only')} />)
} else {
  const configuredApiUrl = import.meta.env.VITE_API_BASE_URL?.trim()
  const apiUrl = configuredApiUrl || (import.meta.env.DEV ? 'http://localhost:3000' : '')

  if (!apiUrl) {
    render(<AndroidStartupScreen error={i18n.t('common.apiNotConfigured')} />)
  } else {
    const startApplication = async (): Promise<void> => {
      render(<AndroidStartupScreen />)
      try {
        const allowInsecureLocalApi = import.meta.env.DEV ||
          (Capacitor.isNativePlatform() && import.meta.env.VITE_ALLOW_INSECURE_LOCAL_API === 'true')
        const apiClient = new ApiClient(apiUrl, 15_000, allowInsecureLocalApi)
        const workspace = useWorkspaceStore.getState()
        apiClient.setWorkspace(workspace.branchId, workspace.warehouseId)
        useWorkspaceStore.subscribe((state) => {
          apiClient.setWorkspace(state.branchId, state.warehouseId)
        })
        const services = createOnlineApplicationServices(apiClient)
        await apiClient.health()
        const [initialSetupRequired] = await Promise.all([
          services.authentication.needsInitialOwnerSetup(),
          services.authentication.restoreSession(),
        ])
        render(
          <App
            services={services}
            initialSetupRequired={initialSetupRequired}
          />,
        )
      } catch (error) {
        reportError(error, 'Online application startup')
        render(
          <AndroidStartupScreen
            error={error instanceof Error ? error.message : i18n.t('common.serverUnavailable')}
            onRetry={() => void startApplication()}
          />,
        )
      }
    }
    void startApplication()
  }
}
