import AppShell from '@/components/AppShell'
import { AppProvider } from '@/context/AppContext'
import { AuthProvider } from '@/context/AuthContext'

/** Tout l'espace applicatif : session, etat, synchro, chrome PWA. */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppProvider>
        <AppShell>{children}</AppShell>
      </AppProvider>
    </AuthProvider>
  )
}
