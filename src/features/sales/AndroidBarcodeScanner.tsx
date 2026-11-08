import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { PluginListenerHandle } from '@capacitor/core'
import type { BarcodeScannerPlugin } from '@capacitor-mlkit/barcode-scanning'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/Button'
import { reportError } from '../../shared/errors/report-error'
import { isAndroidApp } from '../../infrastructure/android/androidFileService'

type AndroidBarcodeScannerProps = {
  onBarcode: (value: string) => void
  onClose: () => void
  onError: (message: string) => void
}

export function AndroidBarcodeScanner({
  onBarcode,
  onClose,
  onError,
}: AndroidBarcodeScannerProps) {
  const { t } = useTranslation()

  useEffect(() => {
    const session: {
      disposed: boolean
      completed: boolean
      scanning: boolean
      listener: PluginListenerHandle | undefined
      scanner: BarcodeScannerPlugin | undefined
    } = {
      disposed: false,
      completed: false,
      scanning: false,
      listener: undefined,
      scanner: undefined,
    }

    const stop = async (): Promise<void> => {
      document.body.classList.remove('android-barcode-scanner-active')
      document.documentElement.classList.remove('android-barcode-scanner-active')
      const failures: unknown[] = []
      if (session.listener) {
        try {
          await session.listener.remove()
        } catch (error) {
          failures.push(error)
        }
        session.listener = undefined
      }
      if (session.scanning) {
        session.scanning = false
        try {
          await session.scanner?.stopScan()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Android barcode scanner cleanup failed')
      }
    }

    const fail = async (message: string, cause?: unknown): Promise<void> => {
      if (session.completed) return
      session.completed = true
      if (cause !== undefined) reportError(cause, 'Android barcode scanner')
      try {
        await stop()
      } catch (cleanupError) {
        reportError(cleanupError, 'Android barcode scanner cleanup')
      }
      if (!session.disposed) {
        onError(message)
        onClose()
      }
    }

    const start = async (): Promise<void> => {
      if (!isAndroidApp()) {
        await fail(t('android.scanUnavailable'))
        return
      }
      const plugin = await import('@capacitor-mlkit/barcode-scanning')
      if (session.disposed) return
      session.scanner = plugin.BarcodeScanner
      const { supported } = await session.scanner.isSupported()
      if (!supported) {
        await fail(t('android.scanUnavailable'))
        return
      }
      const permissions = await session.scanner.requestPermissions()
      if (session.disposed) return
      if (permissions.camera !== 'granted') {
        await fail(t('android.cameraDenied'))
        return
      }

      document.body.classList.add('android-barcode-scanner-active')
      document.documentElement.classList.add('android-barcode-scanner-active')
      session.listener = await session.scanner.addListener('barcodesScanned', ({ barcodes }) => {
        const value = barcodes.find((barcode) => barcode.rawValue?.trim())?.rawValue
        if (!value || session.completed) return
        session.completed = true
        void stop().then(() => {
          if (session.disposed) return
          onBarcode(value)
          onClose()
        }).catch((error: unknown) => {
          reportError(error, 'Android barcode scanner cleanup')
          if (!session.disposed) {
            onError(t('android.scanUnavailable'))
            onClose()
          }
        })
      })
      if (session.disposed) {
        await stop()
        return
      }
      session.scanning = true
      await session.scanner.startScan({
        formats: [
          plugin.BarcodeFormat.Ean8,
          plugin.BarcodeFormat.Ean13,
          plugin.BarcodeFormat.UpcA,
          plugin.BarcodeFormat.UpcE,
          plugin.BarcodeFormat.Code128,
          plugin.BarcodeFormat.Code39,
          plugin.BarcodeFormat.Itf,
        ],
        lensFacing: plugin.LensFacing.Back,
      })
    }

    void start().catch((cause: unknown) => {
      void fail(t('android.scanUnavailable'), cause)
    })

    return () => {
      session.disposed = true
      if (!session.completed) session.completed = true
      void stop().catch((error: unknown) =>
        reportError(error, 'Android barcode scanner cleanup'),
      )
    }
  }, [onBarcode, onClose, onError, t])

  return createPortal(
    <section
      aria-label={t('android.scanTitle')}
      aria-modal="true"
      className="android-barcode-scanner-overlay"
      role="dialog"
    >
      <div className="android-barcode-scanner-controls">
        <h2>{t('android.scanTitle')}</h2>
        <p>{t('android.scanInstructions')}</p>
        <Button onClick={onClose} variant="secondary">
          {t('android.cancelScan')}
        </Button>
      </div>
    </section>,
    document.body,
  )
}
