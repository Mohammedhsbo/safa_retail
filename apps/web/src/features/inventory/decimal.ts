import { InventoryError } from './inventory.errors'

const scale = 1_000_000_000n
const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/

export function parseDecimal(value: string, field: string): bigint {
  if (!decimalPattern.test(value)) {
    throw new InventoryError(`${field} must be a non-negative decimal`)
  }
  const [whole = '0', fraction = ''] = value.split('.')
  return BigInt(whole) * scale + BigInt(fraction.padEnd(9, '0'))
}

export function formatDecimal(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / scale
  const fractional = (absolute % scale).toString().padStart(9, '0')
  const trimmedFraction = fractional.replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole.toString()}${
    trimmedFraction ? `.${trimmedFraction}` : ''
  }`
}

export function multiplyDecimal(left: bigint, right: bigint): bigint {
  const product = left * right
  const rounded =
    product >= 0n
      ? (product + scale / 2n) / scale
      : (product - scale / 2n) / scale
  return rounded
}

export function divideDecimal(dividend: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) {
    throw new InventoryError('A decimal divisor must be greater than zero')
  }
  const numerator = dividend * scale
  return numerator >= 0n
    ? (numerator + divisor / 2n) / divisor
    : (numerator - divisor / 2n) / divisor
}

export function quantityWithinPrecision(
  quantity: bigint,
  decimalPlaces: number,
): boolean {
  if (quantity < 0n || decimalPlaces < 0 || decimalPlaces > 9) {
    return false
  }
  const precision = 10n ** BigInt(9 - decimalPlaces)
  return quantity % precision === 0n
}
