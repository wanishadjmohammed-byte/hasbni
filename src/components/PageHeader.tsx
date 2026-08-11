import type { ReactNode } from 'react'

export default function PageHeader({
  title,
  subtitle,
  action,
  leading,
}: {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  leading?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/50 bg-white/20 px-6 py-5 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        {leading}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight text-navy">{title}</h1>
          {subtitle && <div className="mt-0.5 text-xs font-medium text-navy/50">{subtitle}</div>}
        </div>
        {action}
      </div>
    </header>
  )
}
