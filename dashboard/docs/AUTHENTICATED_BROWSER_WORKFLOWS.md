# Authenticated Browser Workflows

## Existing capability and completed wiring

The browser engine already supported indexed text/password input, clear/replace,
click, Enter and other safe keys, select controls, checkbox interaction through
validated clicks, bounded waits, scrolling, navigation, and continued browsing
after a form submission. It also already supported reference-based
`<secret>key</secret>` actions with domain-scoped resolution. The missing piece
was secure delivery of a Run's `SECRET` variables from dashboard admission to
the standalone worker.

Manual and public-API Runs now deliver those values through the encrypted,
immutable Run snapshot described in `AGENT_VARIABLES.md`. The LLM sees secret
names, never their raw values. Browser input receives the resolved value only
after the current page matches an explicitly allowed domain. Action events keep
only action names and safe wording; final/structured results and errors are
redacted again before persistence.

## Configure a login Agent

Create an Agent such as:

```text
Name: Account Dashboard Inspector
Target: https://example.test/login

Variables:
email     TEXT, required
password  SECRET, required

Goal:
Open the login page and sign in using {{email}} and {{password}}.
After login, report the page title, account status, and the three most
important visible facts. Do not modify settings, make purchases, delete data,
or leave the allowed domain.
```

Configure safety with `example.test` in Allowed domains, Forms set to
`Ordinary forms only` (or `Allowed`), destructive actions blocked, and uploads,
downloads and payments blocked. Add a separate authentication hostname to the
allowlist only when the legitimate login flow actually uses it; redirects never
broaden the list automatically.

Supply the password in the Run form each time. It is not saved as an Agent
default. Password inputs use the browser's native masked field behavior and no
screenshot caption or metadata contains the underlying value.

## Safety behavior

- `BLOCKED` prevents both typing into forms and submitting them. Form permission
  does not enable payments, uploads, downloads, or destructive actions.
- Secret input requires the current page to pass the stored domain and redirect
  policy and the target to pass the engine's editable-element validation.
- Each resolved secret value may be entered only once per Run. The task also
  instructs the Agent to submit the credential set once, preventing aggressive
  retries and reducing account-lockout risk.
- CAPTCHA, MFA, OTP, hardware-key, account-lock, and similar challenges are not
  solved or bypassed. The Agent stops and reports that user interaction is
  required.
- Login success is not site-specific. Existing bounded navigation/page-ready
  behavior runs after submit, then the Agent inspects the resulting page and
  reports whether authentication appears successful.

## Known limitations

There is no reusable credential vault, scheduled-secret support, persisted
authenticated browser profile, or human handoff for MFA/CAPTCHA. A site may
render a nonstandard credential widget that its own DOM does not expose as an
editable form control; the Agent will stop instead of using arbitrary JavaScript
or bypassing that control.
