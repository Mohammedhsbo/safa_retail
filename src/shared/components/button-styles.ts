export type ButtonVariant = 'primary' | 'secondary'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--brand)] text-white shadow-[var(--shadow-brand)] hover:bg-[var(--brand-strong)]',
  secondary:
    'border border-[var(--border)] bg-white text-[var(--ink)] hover:border-[var(--brand-border)] hover:bg-[var(--brand-wash)]',
}

export function getButtonClassName(
  variant: ButtonVariant,
  className = '',
): string {
  return [
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:pointer-events-none disabled:opacity-50',
    variantClasses[variant],
    className,
  ]
    .filter(Boolean)
    .join(' ')
}
