import { NextResponse, type NextRequest } from 'next/server'

/**
 * Filtre d'entree de la console.
 *
 * Il ne fait que verifier la PRESENCE du cookie : le middleware s'execute sur
 * le runtime Edge, ou `node:crypto` n'est pas disponible pour valider la
 * signature. La verification reelle a lieu dans chaque page serveur, via
 * `requireAdmin()`. Ce filtre est une commodite de redirection, pas la
 * protection — celle-ci ne doit jamais dependre d'une seule couche.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.startsWith('/admin') || pathname.startsWith('/admin/login')) {
    return NextResponse.next()
  }

  if (!request.cookies.get('hasbni_admin')) {
    const url = request.nextUrl.clone()
    url.pathname = '/admin/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
