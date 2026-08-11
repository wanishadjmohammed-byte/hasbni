import clsx from 'clsx'
import type { User } from '@/lib/types'

const sizes = {
  sm: 'h-8 w-8 text-sm',
  md: 'h-10 w-10 text-base',
  lg: 'h-12 w-12 text-lg',
  xl: 'h-16 w-16 text-2xl',
}

export default function Avatar({
  user,
  size = 'md',
  className,
}: {
  user: Pick<User, 'name' | 'avatar' | 'color'>
  size?: keyof typeof sizes
  className?: string
}) {
  return (
    <div
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-full border border-white/70 font-bold text-white shadow-sm',
        sizes[size],
        className
      )}
      style={{
        background: user.avatar
          ? 'rgba(255,255,255,0.6)'
          : `linear-gradient(135deg, ${user.color ?? '#22A06B'}, #14724F)`,
      }}
      aria-hidden
    >
      {user.avatar ?? user.name.charAt(0).toUpperCase()}
    </div>
  )
}
