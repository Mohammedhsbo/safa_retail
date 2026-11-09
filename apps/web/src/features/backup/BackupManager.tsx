import { useState } from 'react'
import { AlertTriangle, Download, FileUp, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../shared/components/Button'
import { Card } from '../../shared/components/Card'
import { ToastError } from '../../shared/components/ToastError'
import {
  isAndroidApp,
  pickAndroidBackupFile,
  saveAndShareAndroidFile,
} from '../../infrastructure/android/androidFileService'
import {
  MAXIMUM_BACKUP_BYTES,
  type BackupPreview,
  type BackupSchedule,
  type BackupService,
} from './BackupService'

type BackupManagerProps = {
  backupService: Pick<
    BackupService,
    'createBackup' | 'previewBackup' | 'restoreBackup' | 'configureSchedule' | 'getSchedule'
  >
  actorId: string
}

export function BackupManager({ backupService, actorId }: BackupManagerProps) {
  const { t } = useTranslation()
  const [backupBytes, setBackupBytes] = useState<Uint8Array | null>(null)
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [schedule, setSchedule] = useState<BackupSchedule | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [intervalDays, setIntervalDays] = useState('7')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const downloadBackup = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const bytes = await backupService.createBackup(actorId)
      const fileName = `safa-retail-backup-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.safa`
      if (isAndroidApp()) {
        await saveAndShareAndroidFile(bytes, fileName)
      } else {
        const blob = new Blob([bytes.slice().buffer], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = fileName
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 0)
      }
      setSchedule(await backupService.getSchedule(actorId))
      setMessage(t('backup.exportComplete'))
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : t('backup.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const selectBackup = async (file: File | undefined): Promise<void> => {
    setBackupBytes(null)
    setPreview(null)
    setConfirmed(false)
    setError('')
    setMessage('')
    if (!file) return
    if (file.size > MAXIMUM_BACKUP_BYTES) {
      setError(t('backup.fileTooLarge'))
      return
    }
    setBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const checked = await backupService.previewBackup(actorId, bytes)
      setBackupBytes(bytes)
      setPreview(checked)
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : t('backup.invalidFile'))
    } finally {
      setBusy(false)
    }
  }

  const pickAndroidBackup = async (): Promise<void> => {
    setBackupBytes(null)
    setPreview(null)
    setConfirmed(false)
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const bytes = await pickAndroidBackupFile(MAXIMUM_BACKUP_BYTES)
      if (!bytes) return
      const checked = await backupService.previewBackup(actorId, bytes)
      setBackupBytes(bytes)
      setPreview(checked)
    } catch (backupError) {
      if (
        backupError instanceof Error &&
        backupError.message.includes('pickFiles canceled')
      ) {
        return
      }
      setError(backupError instanceof Error ? backupError.message : t('backup.invalidFile'))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (): Promise<void> => {
    if (!backupBytes || !confirmed) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await backupService.restoreBackup(actorId, backupBytes, confirmed)
      setMessage(t('backup.restoreComplete'))
      setBackupBytes(null)
      setPreview(null)
      setConfirmed(false)
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : t('backup.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const saveSchedule = async (): Promise<void> => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const next = await backupService.configureSchedule(actorId, {
        enabled,
        intervalDays: Number(intervalDays),
      })
      setSchedule(next)
      setMessage(t('backup.scheduleSaved'))
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : t('backup.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const loadSchedule = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const current = await backupService.getSchedule(actorId)
      setSchedule(current)
      setEnabled(current.enabled)
      setIntervalDays(String(current.intervalDays))
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : t('backup.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-[var(--surface)] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <header>
          <p className="text-sm font-bold text-[var(--brand)]">{t('backup.eyebrow')}</p>
          <h1 className="mt-1 text-3xl font-black text-[var(--ink)]">{t('backup.title')}</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">{t('backup.description')}</p>
        </header>

        {error && (
          <>
          <ToastError error={error} />
          <p aria-live="assertive" className="rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">
            {error}
          </p>
          </>
        )}
        {message && (
          <p aria-live="polite" className="rounded-xl bg-green-50 p-4 text-sm text-green-800" role="status">
            {message}
          </p>
        )}

        <Card as="section" className="space-y-4 p-5">
          <h2 className="text-lg font-extrabold text-[var(--ink)]">{t('backup.exportTitle')}</h2>
          <p className="text-sm text-[var(--muted)]">{t('backup.sensitiveNotice')}</p>
          <Button disabled={busy} onClick={() => void downloadBackup()}>
            <Download aria-hidden="true" size={18} />
            {busy ? t('backup.working') : t('backup.exportAction')}
          </Button>
        </Card>

        <Card as="section" className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-[var(--ink)]">{t('backup.scheduleTitle')}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{t('backup.scheduleNotice')}</p>
            </div>
            <Button disabled={busy} onClick={() => void loadSchedule()} variant="secondary">
              {t('backup.loadSchedule')}
            </Button>
          </div>
          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void saveSchedule()
            }}
          >
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
              <input
                checked={enabled}
                disabled={busy}
                onChange={(event) => setEnabled(event.target.checked)}
                type="checkbox"
              />
              {t('backup.enableSchedule')}
            </label>
            <label className="grid gap-1 text-sm font-semibold text-[var(--ink)]">
              {t('backup.intervalDays')}
              <input
                className="rounded-xl border border-[var(--border)] bg-white px-3 py-2"
                disabled={busy}
                max={365}
                min={1}
                onChange={(event) => setIntervalDays(event.target.value)}
                required
                type="number"
                value={intervalDays}
              />
            </label>
            <Button disabled={busy} type="submit">
              <Save aria-hidden="true" size={18} />
              {t('backup.saveSchedule')}
            </Button>
          </form>
          {schedule?.enabled && (
            <p className="text-sm text-[var(--muted)]">
              {schedule.due
                ? t('backup.backupDue')
                : t('backup.nextBackupDue', { date: schedule.nextBackupDueAt })}
            </p>
          )}
        </Card>

        <Card as="section" className="space-y-4 p-5">
          <h2 className="text-lg font-extrabold text-[var(--ink)]">{t('backup.restoreTitle')}</h2>
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
            {t('backup.restoreWarning')}
          </p>
          {isAndroidApp() ? (
            <Button
              disabled={busy}
              onClick={() => void pickAndroidBackup()}
              variant="secondary"
            >
              <FileUp aria-hidden="true" size={18} />
              {t('backup.chooseFile')}
            </Button>
          ) : (
            <label className="grid gap-2 text-sm font-semibold text-[var(--ink)]">
              {t('backup.chooseFile')}
              <input
                accept=".safa,.json,application/json"
                disabled={busy}
                onChange={(event) => void selectBackup(event.target.files?.[0])}
                type="file"
              />
            </label>
          )}
          {preview && (
            <div className="rounded-xl border border-[var(--border)] p-4 text-sm text-[var(--ink)]">
              <p>{t('backup.exportedAt', { date: preview.exportedAt })}</p>
              <p>{t('backup.tableCount', { count: preview.tableCount })}</p>
              <p>{t('backup.rowCount', { count: preview.rowCount })}</p>
            </div>
          )}
          {preview && (
            <>
              <label className="flex items-start gap-2 text-sm font-semibold text-[var(--ink)]">
                <input
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  type="checkbox"
                />
                {t('backup.confirmRestore')}
              </label>
              <Button
                disabled={busy || !confirmed}
                onClick={() => void restore()}
                variant="secondary"
              >
                <FileUp aria-hidden="true" size={18} />
                {busy ? t('backup.working') : t('backup.restoreAction')}
              </Button>
            </>
          )}
        </Card>
      </div>
    </main>
  )
}
