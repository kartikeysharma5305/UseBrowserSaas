export function getAuthCookiePolicy(production: boolean) {
  return {
    useSecureCookies: production,
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: production,
      path: '/',
    },
  };
}
