import { create } from 'zustand'
import type { AuthenticatedUser } from './auth.types'

interface SessionState {
  user: AuthenticatedUser | null
  startedAt: string | null
  establishSession: (user: AuthenticatedUser) => void
  clearSession: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  startedAt: null,
  establishSession: (user) =>
    set({ user, startedAt: new Date().toISOString() }),
  clearSession: () => set({ user: null, startedAt: null }),
}))

export type SessionStore = Pick<
  SessionState,
  'establishSession' | 'clearSession'
>

export const zustandSessionStore: SessionStore = {
  establishSession: (user) =>
    useSessionStore.getState().establishSession(user),
  clearSession: () => useSessionStore.getState().clearSession(),
}
