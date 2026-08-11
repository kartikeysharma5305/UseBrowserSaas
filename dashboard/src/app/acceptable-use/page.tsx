import { LegalPage } from '@/components/legal/legal-page';

export default function AcceptableUsePage() {
  return (
    <LegalPage
      title="Acceptable Use Policy"
      documentType="ACCEPTABLE_USE"
      introduction="Use the browser automation service only where you are authorized. Technical safety and abuse controls support this policy but cannot identify every prohibited activity."
      sections={[
        {
          heading: 'Prohibited access and deception',
          paragraphs: [
            'Do not perform unauthorized account access, credential stuffing or theft, phishing, malware delivery, fraud, impersonation, access-control bypass, security evasion, or attacks against private or internal networks.',
          ],
        },
        {
          heading: 'Prohibited automation',
          paragraphs: [
            'Do not conduct abusive or prohibited scraping, spam, illegal surveillance, harassment, harmful high-impact automation, or purchases of controlled or prohibited goods. Do not use the service to evade website security or violate applicable target-site restrictions.',
          ],
        },
        {
          heading: 'Operational restrictions',
          paragraphs: [
            'Payment actions, private-network navigation, uploads, and downloads are restricted by current execution-safety controls. You must not attempt to disable or circumvent those controls or platform rate limits.',
          ],
        },
        {
          heading: 'Enforcement',
          paragraphs: [
            'The operator may block Runs, revoke API keys, disable scheduling/webhooks, suspend access, or terminate beta participation when necessary for safety or security. Report suspected abuse through the configured security contact.',
          ],
        },
      ]}
    />
  );
}
