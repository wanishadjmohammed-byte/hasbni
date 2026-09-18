import LoginForm from '@/components/admin/LoginForm'

export const dynamic = 'force-dynamic'

export default function AdminLoginPage() {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Console Hasbni</h1>
        <p className="sub">
          Reservee aux comptes inscrits dans <span className="mono">admin_users</span>. Chaque
          connexion est journalisee.
        </p>
        <LoginForm />
      </div>
    </div>
  )
}
