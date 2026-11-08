import { ErrorBoundary } from './ui/ErrorBoundary'
import { AndroidLifecycle } from './AndroidLifecycle'
import {
  RetailApplicationServicesProvider,
  type RetailApplicationServices,
} from './RetailApplicationServices'
import { AuthenticatedApplication } from './AuthenticatedApplication'

export function AppRoutes({
  services,
  initialSetupRequired = false,
}: {
  services?: RetailApplicationServices
  initialSetupRequired?: boolean
}) {
  const activeServices = services ?? {} as RetailApplicationServices

  return (
    <ErrorBoundary>
      <AndroidLifecycle />
      <RetailApplicationServicesProvider services={activeServices}>
        <AuthenticatedApplication
          initialSetupRequired={initialSetupRequired}
        />
      </RetailApplicationServicesProvider>
    </ErrorBoundary>
  )
}
