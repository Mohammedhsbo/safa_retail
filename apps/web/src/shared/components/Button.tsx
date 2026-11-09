import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { getButtonClassName, type ButtonVariant } from './button-styles'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string
  variant?: ButtonVariant
  children: ReactNode
}

export function Button(props: ButtonProps) {
  const { className, variant = 'primary', children, type, ...buttonProps } =
    props
  const buttonClassName = getButtonClassName(variant, className)

  return (
    <button
      {...buttonProps}
      className={buttonClassName}
      type={type ?? 'button'}
    >
      {children}
    </button>
  )
}
