import { Activity, Home, User, Users } from 'lucide-react'

export const NAV_ITEMS = [
  { href: '/', label: 'Accueil', icon: Home },
  { href: '/groupes', label: 'Groupes', icon: Users },
  { href: '/activite', label: 'Activite', icon: Activity },
  { href: '/profil', label: 'Profil', icon: User },
] as const
