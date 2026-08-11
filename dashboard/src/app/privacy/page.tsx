import { LegalPage } from '@/components/legal/legal-page';

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      documentType="PRIVACY"
      introduction="This closed-beta notice explains how the service currently handles personal and automation data. It is designed to support privacy operations and requires qualified legal review before public launch."
      sections={[
        {
          heading: 'Data we handle',
          paragraphs: [
            'We store account identity, Agent definitions and variables, Run inputs and results, schedules, usage, notification and webhook records, billing entitlement metadata, and retained screenshots or artifacts. API-key plaintext is shown only at creation; hashes are stored. Webhook signing material is encrypted.',
          ],
        },
        {
          heading: 'Automation and AI providers',
          paragraphs: [
            'Tasks, target-site context, and page content needed for execution may be sent to the configured language-model provider. Agents interact with third-party websites governed by their own terms and privacy notices. Avoid supplying unnecessary sensitive information.',
          ],
        },
        {
          heading: 'Purpose and sharing',
          paragraphs: [
            'Data is used to authenticate users, execute and monitor automations, enforce limits and safety, provide billing and service notifications, support APIs/webhooks, prevent abuse, and recover the service. Current integrations can include Groq, Stripe, a configured email provider, storage provider, and hosting/database operators.',
          ],
        },
        {
          heading: 'Retention, export, and deletion',
          paragraphs: [
            'Artifact retention is currently plan-based: 7 days for FREE, 30 for PRO, and 90 for INTERNAL, plus a short downgrade grace period. Other operational and financial retention requires operator policy and legal review. Settings provides a bounded portable export and recoverable account deletion. Old backups can contain data deleted later; production operations must maintain a separate deletion journal and bounded backup retention.',
          ],
        },
        {
          heading: 'Security and choices',
          paragraphs: [
            'Technical controls include owner scoping, encrypted or hashed credential material, redacted logs, network restrictions, rate limits, backup verification, and account deletion. No control eliminates every risk. Contact the configured privacy address for correction, restriction, or other requests not automated in the product.',
          ],
        },
        {
          heading: 'International use, children, and changes',
          paragraphs: [
            'Provider and hosting regions remain a deployment decision. Minimum age, legal basis, international-transfer language, and jurisdiction-specific rights require legal decisions before public launch. Material policy versions can require a new recorded acknowledgement.',
          ],
        },
      ]}
    />
  );
}
