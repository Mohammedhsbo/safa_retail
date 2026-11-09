import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, LogOut, MapPin, ShieldCheck, UserRound } from 'lucide-react'
import type { AuthenticatedUser } from '@safa/types'
import { isGlobalBranchAdmin } from './auth.types'

type AccountMenuProps = {
  user: AuthenticatedUser
  onLogout: () => Promise<void>
}

export function AccountMenu({ user, onLogout }: AccountMenuProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const canEditProfile = user.permissions.includes('users.manage')
  const canChangeLocation = isGlobalBranchAdmin(user.roleCodes)

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsideClick = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const openProfile = (): void => {
    setMenuOpen(false)
    navigate('/profile')
  }

  const changeBranch = (): void => {
    setMenuOpen(false)
    navigate('/branch-selection')
  }

  const signOut = async (): Promise<void> => {
    setMenuOpen(false)
    await onLogout()
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={t('accountMenu.open', { name: user.displayName })}
        className="group flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--border)] bg-white py-1.5 ps-1.5 pe-3 text-start shadow-sm transition hover:border-[var(--brand)] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
        onClick={() => setMenuOpen((open) => !open)}
        type="button"
      >
        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-[var(--brand)] to-[var(--brand-strong)] text-white shadow-sm">
          <UserRound aria-hidden="true" size={19} />
        </span>
        <span className="hidden max-w-36 truncate text-sm font-bold text-[var(--ink)] sm:inline">
          {user.displayName}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`hidden text-[var(--muted)] transition sm:block ${menuOpen ? 'rotate-180' : ''}`}
          size={16}
        />
      </button>

      {menuOpen && (
        <div
          className="absolute end-0 top-[calc(100%+0.65rem)] z-50 w-[min(19rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-[var(--border)] bg-white p-2 shadow-[0_20px_60px_-18px_rgba(16,44,33,0.28)]"
          role="menu"
        >
          <div className="mb-1 rounded-2xl bg-gradient-to-br from-[var(--brand-wash)] to-white p-4">
            <p className="truncate font-extrabold text-[var(--ink)]">{user.displayName}</p>
            <p className="mt-1 truncate text-sm text-[var(--muted)]" dir="ltr">@{user.username}</p>
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-border)] bg-white/80 px-2.5 py-1 text-xs font-bold text-[var(--brand)]">
              <ShieldCheck aria-hidden="true" size={14} />
              {canEditProfile ? t('accountMenu.administrator') : t('accountMenu.user')}
            </span>
          </div>
          <button
            className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-start text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface)]"
            onClick={openProfile}
            role="menuitem"
            type="button"
          >
            <UserRound aria-hidden="true" className="text-[var(--brand)]" size={18} />
            <span>{t('accountMenu.profile')}</span>
          </button>
          {canChangeLocation && (
            <button
              className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-start text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface)]"
              onClick={changeBranch}
              role="menuitem"
              type="button"
            >
              <MapPin aria-hidden="true" className="text-[var(--brand)]" size={18} />
              <span>{t('navigation.changeLocation')}</span>
            </button>
          )}
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-start text-sm font-bold text-red-700 transition hover:bg-red-50"
            onClick={() => void signOut()}
            role="menuitem"
            type="button"
          >
            <LogOut aria-hidden="true" size={18} />
            <span>{t('auth.signOut')}</span>
          </button>
        </div>
      )}
    </div>
  )
}
