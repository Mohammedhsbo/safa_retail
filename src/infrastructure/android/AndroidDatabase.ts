import { Capacitor } from '@capacitor/core'
import { openAndInitializeNativeDatabase } from '../database/setup'
import type { SqliteDatabase } from '../database/SqliteDatabase'
import type { DatabaseHealth } from '../database/types'

let database: SqliteDatabase | undefined
let initialization: Promise<DatabaseHealth> | undefined

export function getAndroidDatabase(): SqliteDatabase {
  if (!database) {
    throw new Error('The Android database has not been initialized')
  }
  return database
}

export function initializeAndroidDatabase(): Promise<DatabaseHealth> {
  if (Capacitor.getPlatform() !== 'android') {
    return Promise.reject(
      new Error('The persistent application database is supported only on Android'),
    )
  }
  if (initialization) return initialization

  initialization = openAndInitializeNativeDatabase().then((opened) => {
    database = opened.database
    return opened.health
  }).catch((error: unknown) => {
    initialization = undefined
    throw error
  })

  return initialization
}
