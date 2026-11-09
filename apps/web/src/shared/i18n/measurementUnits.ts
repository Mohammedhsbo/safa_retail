import type { TFunction } from 'i18next'

const measurementUnitKeys: Record<string, string> = {
  piece: 'piece',
  package: 'package',
  carton: 'carton',
  kilogram: 'kilogram',
  ton: 'ton',
  liter: 'liter',
  milliliter: 'milliliter',
  meter: 'meter',
  roll: 'roll',
  top: 'top',
  التوب: 'top',
  bundle: 'bundle',
}

export function translateMeasurementUnit(name: string, t: TFunction): string {
  const key = measurementUnitKeys[name.trim().toLowerCase()]
  return key ? t(`catalog.measurementUnits.${key}`) : name
}
