import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { Printer } from '@capgo/capacitor-printer'
import type { ReadFileResult } from '@capacitor/filesystem'

const fileChunkSize = 1024 * 1024
const androidFileDirectory = 'safa-retail'

export function isAndroidApp(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function pickAndroidBackupFile(
  maximumBytes: number,
): Promise<Uint8Array | undefined> {
  assertAndroid()
  const { FilePicker } = await import('@capawesome/capacitor-file-picker')
  const result = await FilePicker.pickFiles({
    types: ['application/json', 'application/octet-stream'],
    limit: 1,
  })
  const file = result.files[0]
  if (!file) return undefined

  if (file.size > maximumBytes) {
    throw new Error('The selected backup exceeds the supported file size')
  }
  if (!file.path) {
    throw new Error('The Android file picker did not return a readable file URI')
  }

  const metadata = await Filesystem.stat({ path: file.path })
  if (metadata.size > maximumBytes) {
    throw new Error('The selected backup exceeds the supported file size')
  }

  return readAndroidFile(file.path, metadata.size, maximumBytes)
}

export async function saveAndShareAndroidFile(
  bytes: Uint8Array,
  fileName: string,
): Promise<void> {
  assertAndroid()
  const uri = await writeAndroidFile(bytes, fileName, Directory.Cache)
  let operationError: unknown
  try {
    const capability = await Share.canShare()
    if (!capability.value) {
      throw new Error('Android file sharing is not available on this device')
    }
    await Share.share({
      title: fileName,
      text: 'SAFA Retail export',
      files: [uri],
      dialogTitle: 'Share SAFA Retail file',
    })
  } catch (error) {
    operationError = error
  }
  try {
    await Filesystem.deleteFile({
      path: `${androidFileDirectory}/${fileName}`,
      directory: Directory.Cache,
    })
  } catch (cleanupError) {
    if (operationError !== undefined) {
      throw new AggregateError(
        [operationError, cleanupError],
        'Android sharing failed and its temporary file could not be removed',
      )
    }
    throw cleanupError
  }
  if (operationError !== undefined) throw operationError
}

export async function printAndroidPdf(
  bytes: Uint8Array,
  fileName: string,
): Promise<void> {
  assertAndroid()
  const uri = await writeAndroidFile(bytes, fileName, Directory.Cache)
  let operationError: unknown
  try {
    await Printer.printPdf({ name: fileName, path: uri })
  } catch (error) {
    operationError = error
  }
  try {
    await Filesystem.deleteFile({
      path: `${androidFileDirectory}/${fileName}`,
      directory: Directory.Cache,
    })
  } catch (cleanupError) {
    if (operationError !== undefined) {
      throw new AggregateError(
        [operationError, cleanupError],
        'Android printing failed and its temporary file could not be removed',
      )
    }
    throw cleanupError
  }
  if (operationError !== undefined) throw operationError
}

export async function shareAndroidText(
  title: string,
  text: string,
): Promise<void> {
  assertAndroid()
  const capability = await Share.canShare()
  if (!capability.value) {
    throw new Error('Android sharing is not available on this device')
  }
  await Share.share({ title, text, dialogTitle: title })
}

async function writeAndroidFile(
  bytes: Uint8Array,
  fileName: string,
  directory: Directory,
): Promise<string> {
  if (bytes.byteLength === 0) {
    throw new Error('Cannot export an empty file')
  }
  if (!/^[\w.-]+$/.test(fileName)) {
    throw new Error('The Android export filename is invalid')
  }

  const path = `${androidFileDirectory}/${fileName}`
  await Filesystem.mkdir({
    path: androidFileDirectory,
    directory,
    recursive: true,
  })

  try {
    for (let offset = 0; offset < bytes.byteLength; offset += fileChunkSize) {
      const chunk = bytes.subarray(
        offset,
        Math.min(offset + fileChunkSize, bytes.byteLength),
      )
      const base64 = encodeBase64(chunk)
      if (offset === 0) {
        await Filesystem.writeFile({ path, data: base64, directory })
      } else {
        await Filesystem.appendFile({ path, data: base64, directory })
      }
    }
    return (await Filesystem.getUri({ path, directory })).uri
  } catch (error) {
    try {
      await Filesystem.deleteFile({ path, directory })
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Android file export failed and its incomplete file could not be removed',
      )
    }
    throw error
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const conversionChunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += conversionChunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + conversionChunkSize, bytes.length)),
    )
  }
  return btoa(binary)
}

async function readAndroidFile(
  path: string,
  expectedBytes: number,
  maximumBytes: number,
): Promise<Uint8Array> {
  const decodedChunks: Uint8Array[] = []
  let totalBytes = 0
  let settled = false

  return new Promise<Uint8Array>((resolve, reject) => {
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      reject(error)
    }

    void Filesystem.readFileInChunks(
      { path, chunkSize: 1024 * 1024 },
      (chunk: ReadFileResult | null, error?: unknown) => {
        if (settled) return
        if (error !== undefined) {
          fail(error)
          return
        }
        if (chunk === null) {
          fail(new Error('Android file reading ended unexpectedly'))
          return
        }
        if (typeof chunk.data !== 'string') {
          fail(new Error('Android file picker returned invalid file contents'))
          return
        }
        if (chunk.data.length === 0) {
          settled = true
          if (totalBytes !== expectedBytes) {
            reject(new Error('The selected backup file changed while being read'))
            return
          }
          resolve(joinChunks(decodedChunks, totalBytes))
          return
        }
        try {
          const bytes = decodeBase64(chunk.data)
          totalBytes += bytes.byteLength
          if (totalBytes > maximumBytes || totalBytes > expectedBytes) {
            fail(new Error('The selected backup exceeds the supported file size'))
            return
          }
          decodedChunks.push(bytes)
        } catch (decodeError) {
          fail(decodeError)
        }
      },
    ).catch(fail)
  })
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function joinChunks(chunks: Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function assertAndroid(): void {
  if (!isAndroidApp()) {
    throw new Error('This native capability is available only in the Android app')
  }
}
