import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(() => 'android'),
  isNativePlatform: vi.fn(() => true),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async (_options: {
    path: string
    data: string
    directory: string
  }) => ({ uri: 'file://safa-retail/export.bin' })),
  appendFile: vi.fn(async (_options: {
    path: string
    data: string
    directory: string
  }) => undefined),
  getUri: vi.fn(async () => ({ uri: 'file://safa-retail/export.bin' })),
  deleteFile: vi.fn(async () => undefined),
  canShare: vi.fn(async () => ({ value: true })),
  share: vi.fn(async () => ({})),
  printPdf: vi.fn(async () => undefined),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: mocks.getPlatform,
    isNativePlatform: mocks.isNativePlatform,
  },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE', Data: 'DATA' },
  Filesystem: {
    mkdir: mocks.mkdir,
    writeFile: mocks.writeFile,
    appendFile: mocks.appendFile,
    getUri: mocks.getUri,
    deleteFile: mocks.deleteFile,
  },
}))

vi.mock('@capacitor/share', () => ({
  Share: { canShare: mocks.canShare, share: mocks.share },
}))

vi.mock('@capgo/capacitor-printer', () => ({
  Printer: { printPdf: mocks.printPdf },
}))

import {
  isAndroidApp,
  printAndroidPdf,
  saveAndShareAndroidFile,
} from './androidFileService'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getPlatform.mockReturnValue('android')
  mocks.isNativePlatform.mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Android native file capabilities', () => {
  it('writes large files in base64 chunks, shares the file, and removes the temporary copy', async () => {
    const bytes = Uint8Array.from(
      { length: 1024 * 1024 + 17 },
      (_, index) => index % 256,
    )

    await saveAndShareAndroidFile(bytes, 'safa-backup.safa')

    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.appendFile).toHaveBeenCalledTimes(1)
    expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({
      files: ['file://safa-retail/export.bin'],
    }))
    const firstChunk = mocks.writeFile.mock.calls[0]?.[0].data
    const secondChunk = mocks.appendFile.mock.calls[0]?.[0].data
    if (firstChunk === undefined || secondChunk === undefined) {
      throw new Error('The Android file was not written in expected chunks')
    }
    const encodedChunks = [firstChunk, secondChunk]
    const decoded = encodedChunks.flatMap((chunk) =>
      Array.from(atob(chunk), (character) => character.charCodeAt(0)),
    )
    expect(decoded).toEqual(Array.from(bytes))
    expect(mocks.deleteFile).toHaveBeenCalledWith({
      path: 'safa-retail/safa-backup.safa',
      directory: 'CACHE',
    })
  })

  it('prints Android PDF files and cleans up the temporary document', async () => {
    await printAndroidPdf(new Uint8Array([37, 80, 68, 70]), 'report.pdf')

    expect(mocks.printPdf).toHaveBeenCalledWith({
      name: 'report.pdf',
      path: 'file://safa-retail/export.bin',
    })
    expect(mocks.deleteFile).toHaveBeenCalledWith({
      path: 'safa-retail/report.pdf',
      directory: 'CACHE',
    })
  })

  it('rejects native operations outside Android without touching the filesystem', async () => {
    mocks.getPlatform.mockReturnValue('ios')

    expect(isAndroidApp()).toBe(false)
    await expect(
      saveAndShareAndroidFile(new Uint8Array([1]), 'file.bin'),
    ).rejects.toThrow(/only in the Android app/)
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('does not silently ignore a failed Android share', async () => {
    mocks.share.mockRejectedValue(new Error('Share activity failed'))

    await expect(
      saveAndShareAndroidFile(new Uint8Array([1]), 'file.bin'),
    ).rejects.toThrow('Share activity failed')
    expect(mocks.deleteFile).toHaveBeenCalled()
  })
})
