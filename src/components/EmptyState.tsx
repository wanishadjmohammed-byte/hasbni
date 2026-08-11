import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="glass flex flex-col items-center rounded-2xl px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <Icon size={22} />
      </div>
      <p className="text-sm font-bold text-navy">{title}</p>
      <p className="mt-1 max-w-xs text-xs font-medium text-navy/45">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
