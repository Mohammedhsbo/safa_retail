import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, LockKeyhole, ShieldCheck, UserRound } from 'lucide-react'
import type { AuthenticatedUser } from '@safa/types'
import { useRetailApplicationServices } from '../../app/RetailApplicationServices'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { ToastError } from '../../shared/components/ToastError'

export function AccountProfileScreen({ user }: { user: AuthenticatedUser }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { authentication } = useRetailApplicationServices()
  const [displayName, setDisplayName] = useState(user.displayName)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const canEditProfile = user.permissions.includes('users.manage')

  const saveProfile = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!canEditProfile || busy) return

    const changingPassword = Boolean(currentPassword || newPassword || confirmPassword)
    if (changingPassword && (!currentPassword || !newPassword || !confirmPassword)) {
      setError(t('accountMenu.passwordFieldsRequired'))
      return
    }
    if (changingPassword && newPassword !== confirmPassword) {
      setError(t('accountMenu.passwordMismatch'))
      return
    }
    if (changingPassword && newPassword.length < 12) {
      setError(t('auth.passwordRequirements'))
      return
    }

    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const updatedUser = await authentication.updateOwnProfile({
        displayName,
        ...(changingPassword ? { currentPassword, newPassword } : {}),
      })
      setDisplayName(updatedUser.displayName)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSaved(true)
    } catch (saveError) {
      const code = typeof saveError === 'object' && saveError !== null && 'code' in saveError
        ? saveError.code
        : ''
      setError(
        code === 'INVALID_CREDENTIALS'
          ? t('accountMenu.currentPasswordIncorrect')
          : t('accountMenu.saveFailed'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <button
        className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[var(--muted)] transition hover:bg-white hover:text-[var(--brand)]"
        onClick={() => navigate('/dashboard')}
        type="button"
      >
        <ArrowLeft aria-hidden="true" className="rtl:rotate-180" size={18} />
        {t('accountMenu.backToDashboard')}
      </button>

      <div className="mb-6 flex items-center gap-3 sm:mb-8">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-strong)] text-white shadow-[var(--shadow-brand)] sm:size-14">
          <UserRound aria-hidden="true" size={25} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-black tracking-tight text-[var(--ink)] sm:text-3xl">
            {t('accountMenu.profile')}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {canEditProfile ? t('accountMenu.editDescription') : t('accountMenu.readOnlyDescription')}
          </p>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 bg-gradient-to-br from-[var(--brand-wash)] via-white to-white px-5 py-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-[var(--brand)] shadow-sm">
              <ShieldCheck aria-hidden="true" size={20} />
            </span>
            <div className="min-w-0">
              <p className="truncate font-extrabold text-[var(--ink)]">{user.displayName}</p>
              <p className="truncate text-sm text-[var(--muted)]" dir="ltr">@{user.username}</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--brand-border)] bg-white/80 px-3 py-1 text-xs font-bold text-[var(--brand)]">
            {canEditProfile ? t('accountMenu.administrator') : t('accountMenu.user')}
          </span>
        </div>

        <form className="space-y-5 p-5 sm:p-7" onSubmit={(event) => void saveProfile(event)}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-bold text-[var(--ink)]">
              {t('auth.username')}
              <input
                autoComplete="username"
                className="min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--muted)]"
                readOnly
                value={user.username}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-bold text-[var(--ink)]">
              {t('auth.displayName')}
              <input
                autoComplete="name"
                className="min-h-12 rounded-xl border border-[var(--border)] bg-white px-3 disabled:bg-[var(--surface)] disabled:text-[var(--muted)]"
                disabled={!canEditProfile || busy}
                maxLength={120}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  setSaved(false)
                }}
                required
                value={displayName}
              />
            </label>
          </div>

          {canEditProfile && (
            <section className="space-y-4 border-t border-[var(--border)] pt-5">
              <div className="flex items-center gap-2">
                <LockKeyhole aria-hidden="true" className="text-[var(--brand)]" size={18} />
                <h2 className="font-extrabold text-[var(--ink)]">{t('accountMenu.changePassword')}</h2>
              </div>
              <p className="text-sm text-[var(--muted)]">{t('auth.passwordRequirements')}</p>
              <label className="grid gap-1.5 text-sm font-bold text-[var(--ink)]">
                {t('accountMenu.currentPassword')}
                <input
                  autoComplete="current-password"
                  className="min-h-12 rounded-xl border border-[var(--border)] bg-white px-3"
                  maxLength={128}
                  minLength={12}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  type="password"
                  value={currentPassword}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-bold text-[var(--ink)]">
                  {t('accountMenu.newPassword')}
                  <input
                    autoComplete="new-password"
                    className="min-h-12 rounded-xl border border-[var(--border)] bg-white px-3"
                    maxLength={128}
                    minLength={12}
                    onChange={(event) => setNewPassword(event.target.value)}
                    type="password"
                    value={newPassword}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-bold text-[var(--ink)]">
                  {t('accountMenu.confirmNewPassword')}
                  <input
                    autoComplete="new-password"
                    className="min-h-12 rounded-xl border border-[var(--border)] bg-white px-3"
                    maxLength={128}
                    minLength={12}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    type="password"
                    value={confirmPassword}
                  />
                </label>
              </div>
            </section>
          )}

          {error && <><ToastError error={error} /><p className="rounded-xl bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p></>}
          {saved && <p className="rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{t('accountMenu.saved')}</p>}

          <div className="flex flex-col-reverse gap-2 border-t border-[var(--border)] pt-5 sm:flex-row sm:justify-end">
            <Button
              className="justify-center"
              onClick={() => navigate('/dashboard')}
              type="button"
              variant="secondary"
            >
              {t('common.cancel')}
            </Button>
            {canEditProfile && (
              <Button className="justify-center" disabled={busy} type="submit">
                {busy ? t('auth.working') : t('accountMenu.saveProfile')}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </main>
  )
}
