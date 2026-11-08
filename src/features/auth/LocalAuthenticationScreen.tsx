import { useState, type FormEvent } from 'react'
import { KeyRound, Store } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { LanguageSwitcher } from '../../shared/components/LanguageSwitcher'
import { ToastError } from '../../shared/components/ToastError'
import { useWorkspaceStore } from '../../shared/state/workspace-store'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'

type LocalAuthenticationScreenProps = {
  initialSetup: boolean
  onSetupComplete: () => void
}

export function LocalAuthenticationScreen({
  initialSetup,
  onSetupComplete,
}: LocalAuthenticationScreenProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { authentication } = useRetailApplicationServices()
  const clearWorkspace = useWorkspaceStore((state) => state.clearWorkspace)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError('')
    if (initialSetup && password !== passwordConfirmation) {
      setError(t('auth.passwordMismatch'))
      return
    }

    setBusy(true)
    try {
      if (initialSetup) {
        await authentication.setupInitialOwner({
          username,
          displayName,
          password,
        })
        onSetupComplete()
      } else {
        await authentication.login({ username, password })
      }
      clearWorkspace()
      navigate('/dashboard', { replace: true })
    } catch (authError) {
      setError(
        initialSetup
          ? authError instanceof Error
            ? authError.message
            : t('auth.setupFailed')
          : t('auth.loginFailed'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center bg-[var(--surface)] p-4 pt-20 sm:p-8 sm:pt-24">
      <div className="absolute end-4 top-4 sm:end-8 sm:top-8">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md space-y-6 p-6 sm:p-8">
        <header className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[var(--brand)] text-white shadow-[var(--shadow-brand)]">
            {initialSetup
              ? <Store aria-hidden="true" size={24} />
              : <KeyRound aria-hidden="true" size={24} />}
          </span>
          <h1 className="mt-4 text-2xl font-black text-[var(--ink)]">
            {initialSetup ? t('auth.setupTitle') : t('auth.loginTitle')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            {initialSetup ? t('auth.setupDescription') : t('auth.loginDescription')}
          </p>
        </header>

        {error && (
          <>
          <ToastError error={error} />
          <p className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">
            {error}
          </p>
          </>
        )}

        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          {initialSetup && (
            <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
              {t('auth.displayName')}
              <input
                autoComplete="name"
                className="min-h-12 rounded-xl border border-[var(--border)] bg-white px-3"
                maxLength={120}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                value={displayName}
              />
            </label>
          )}
          <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
            {t('auth.username')}
            <input
              autoComplete="username"
              className="min-h-12 rounded-xl border border-[var(--border)] bg-white px-3"
              maxLength={64}
              minLength={3}
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
            {t('auth.password')}
            <input
              autoComplete={initialSetup ? 'new-password' : 'current-password'}
              className="min-h-12 rounded-xl border border-[var(--border)] bg-white px-3"
              maxLength={128}
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {initialSetup && (
            <>
              <p className="text-xs leading-5 text-[var(--muted)]">
                {t('auth.passwordRequirements')}
              </p>
              <label className="grid gap-1.5 text-sm font-semibold text-[var(--ink)]">
                {t('auth.confirmPassword')}
                <input
                  autoComplete="new-password"
                  className="min-h-12 rounded-xl border border-[var(--border)] bg-white px-3"
                  maxLength={128}
                  minLength={12}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  required
                  type="password"
                  value={passwordConfirmation}
                />
              </label>
            </>
          )}
          <Button className="w-full justify-center" disabled={busy} type="submit">
            {busy
              ? t('auth.working')
              : initialSetup
                ? t('auth.createOwner')
                : t('auth.signIn')}
          </Button>
        </form>
      </Card>
    </main>
  )
}
