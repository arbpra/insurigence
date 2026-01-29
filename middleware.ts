import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/',
  '/login',
  '/change-password',
  '/intake/public',
  '/api/auth/login',
  '/api/auth/logout', 
  '/api/auth/session',
  '/api/auth/change-password',
  '/api/intake/public',
  '/api/proposal',
  '/pricing',
  '/request-demo',
  '/how-it-works',
  '/who-its-for',
  '/why-insurigence',
  '/sample-proposal',
  '/faq',
  '/compare',
  '/for-producers',
  '/use-cases',
];

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;
  
  for (const path of PUBLIC_PATHS) {
    if (pathname === path || pathname.startsWith(path + '/')) {
      return true;
    }
  }
  
  if (pathname.startsWith('/intake/public/')) return true;
  if (pathname.startsWith('/api/intake/public/')) return true;
  if (pathname.startsWith('/api/proposal/')) return true;
  if (pathname.startsWith('/proposal/')) return true;
  
  if (pathname.startsWith('/_next/') || 
      pathname.startsWith('/static/') ||
      pathname.includes('.')) {
    return true;
  }
  
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const sessionToken = request.cookies.get('session_token')?.value;

  if (!sessionToken) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
