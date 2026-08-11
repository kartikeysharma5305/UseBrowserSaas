import { LegalPage } from '@/components/legal/legal-page';

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookie Policy"
      introduction="The current product uses essential authentication and security cookies. It does not currently load product analytics, advertising, or marketing cookies."
      sections={[
        {
          heading: 'Essential cookies',
          paragraphs: [
            'Better Auth session cookies keep users signed in and protect authenticated access. They are HttpOnly, SameSite-protected, and Secure in production. Security and origin protections support authenticated requests.',
          ],
        },
        {
          heading: 'Preferences and browser storage',
          paragraphs: [
            'Theme preference may be retained in browser storage by the theme component. It is functional preference state, not advertising tracking.',
          ],
        },
        {
          heading: 'No non-essential tracking',
          paragraphs: [
            'No analytics or marketing integration is present in the current repository. Therefore no non-essential-cookie consent banner is loaded. Consent controls must be added before any future analytics or advertising technology is enabled.',
          ],
        },
      ]}
    />
  );
}
