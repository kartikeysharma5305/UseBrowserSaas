# Cookie Policy — Draft for Legal Review

**Requires legal review before public launch.** The current application uses
essential Better Auth session/security cookies: HttpOnly, SameSite-protected,
and Secure in production. They provide sign-in, session renewal and protected
requests. Theme preference can be retained in browser storage.

No analytics, advertising or marketing cookies are currently implemented. No
non-essential-cookie banner is therefore loaded. Before adding tracking, update
this inventory and implement consent controls that prevent loading it before
the required choice. Cookie names/lifetimes should be confirmed against the
production Better Auth configuration during launch review.
