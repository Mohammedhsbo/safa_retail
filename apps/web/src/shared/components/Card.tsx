import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'article' | 'section'
}

export function Card({
  as: Element = 'section',
  className = '',
  ...props
}: CardProps) {
  return (
    <Element
      {...props}
      className={[
        'rounded-[1.75rem] border border-[var(--border)] bg-white shadow-[var(--shadow-card)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}
