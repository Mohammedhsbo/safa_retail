import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Keyboard } from '@capacitor/keyboard'
import { StatusBar, Style } from '@capacitor/status-bar'
import type { PluginListenerHandle } from '@capacitor/core'
import { useNavigate } from 'react-router-dom'
import { reportError } from '../shared/errors/report-error'

export function AndroidLifecycle() {
  const navigate = useNavigate()

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return

    let active = true
    const listeners: PluginListenerHandle[] = []
    const register = async (
      subscription: Promise<PluginListenerHandle>,
    ): Promise<void> => {
      const listener = await subscription
      if (active) {
        listeners.push(listener)
      } else {
        await listener.remove()
      }
    }
    const initialize = async (): Promise<void> => {
      void StatusBar.setStyle({ style: Style.Dark }).catch((error: unknown) =>
        reportError(error, 'Android status bar setup'),
      )
      void StatusBar.show().catch((error: unknown) =>
        reportError(error, 'Android status bar setup'),
      )
      await register(App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) {
          navigate(-1)
        } else {
          void App.exitApp().catch(reportError)
        }
      }))
      await register(App.addListener('appStateChange', ({ isActive }) => {
        document.documentElement.dataset.appActive = String(isActive)
      }))
      await register(App.addListener('appRestoredResult', (result) => {
        window.dispatchEvent(new CustomEvent('safa:android-restored-result', {
          detail: result,
        }))
      }))
      await register(Keyboard.addListener('keyboardDidShow', ({ keyboardHeight }) => {
        document.documentElement.style.setProperty(
          '--android-keyboard-height',
          `${keyboardHeight}px`,
        )
      }))
      await register(Keyboard.addListener('keyboardDidHide', () => {
        document.documentElement.style.removeProperty('--android-keyboard-height')
      }))
    }

    void initialize().catch((error: unknown) => {
      if (active) reportError(error, 'Android lifecycle initialization')
    })

    return () => {
      active = false
      document.documentElement.style.removeProperty('--android-keyboard-height')
      void Promise.all(listeners.map((listener) => listener.remove()))
        .catch((error: unknown) => reportError(error, 'Android lifecycle cleanup'))
    }
  }, [navigate])

  return null
}
