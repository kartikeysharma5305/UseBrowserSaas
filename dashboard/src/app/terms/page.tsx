import { LegalPage } from '@/components/legal/legal-page';

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      documentType="TERMS"
      introduction="These closed-beta terms describe product expectations, not a final public agreement. They require qualified legal review and unresolved business terms before launch."
      sections={[
        {
          heading: 'Accounts and beta service',
          paragraphs: [
            'You are responsible for account security and activity. The beta may change, be limited, experience failures, or be suspended. Service limits and plan quotas apply.',
          ],
        },
        {
          heading: 'Browser automation responsibility',
          paragraphs: [
            'You must have authorization to access and automate each target website and comply with applicable law and third-party terms. DOM changes, anti-automation controls, provider failures, and inaccurate model output can break or alter actions. Review consequential output and actions.',
          ],
        },
        {
          heading: 'Customer content and restrictions',
          paragraphs: [
            'You retain responsibility for tasks, configurations, results, and target-site data you submit. You may not use the service for conduct prohibited by the Acceptable Use Policy. Existing technical safeguards reduce risk but do not detect every misuse.',
          ],
        },
        {
          heading: 'Subscriptions and cancellation',
          paragraphs: [
            'Where Stripe billing is enabled, PRO is recurring. Period-end cancellation retains access through the paid period. Payment-failure access follows the current entitlement state and period. The refund policy remains an unresolved operator/legal decision; no refund promise is made here.',
          ],
        },
        {
          heading: 'Suspension, availability, and legal terms',
          paragraphs: [
            'Accounts may be restricted for security, abuse, non-payment, deletion, or beta operations. Intellectual-property, warranty, liability, indemnity, dispute, governing-law, age, and entity clauses require legal completion before public launch.',
          ],
        },
      ]}
    />
  );
}
