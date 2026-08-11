import Link from 'next/link';

import {
  LEGAL_DOCUMENT_VERSIONS,
  LEGAL_LINKS,
  publicLegalConfiguration,
} from '@/lib/legal/config';

export function LegalPage({
  title,
  documentType,
  introduction,
  sections,
}: {
  title: string;
  documentType?: keyof typeof LEGAL_DOCUMENT_VERSIONS;
  introduction: string;
  sections: Array<{ heading: string; paragraphs: string[] }>;
}) {
  const configuration = publicLegalConfiguration();
  return (
    <main className="min-h-screen bg-white px-6 py-14 text-slate-700 dark:bg-slate-950 dark:text-slate-300">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-medium text-slate-500">
          ← Browser Use Dashboard
        </Link>
        <p className="mt-10 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Closed beta policy
        </p>
        <h1 className="mt-2 text-4xl font-semibold text-slate-950 dark:text-white">
          {title}
        </h1>
        {documentType ? (
          <p className="mt-2 text-xs text-slate-500">
            Version {LEGAL_DOCUMENT_VERSIONS[documentType]}
          </p>
        ) : null}
        <p className="mt-6 leading-7">{introduction}</p>
        <div className="mt-10 space-y-9">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph) => (
                <p className="mt-3 leading-7" key={paragraph}>
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
        <section className="mt-10 border-t border-slate-200 pt-6 text-sm dark:border-slate-800">
          <p>Operator: {configuration.entityName}</p>
          <p className="mt-1">
            Privacy contact:{' '}
            {configuration.privacyEmail ??
              'not yet configured for public launch'}
          </p>
          {!configuration.configured ? (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              This closed-beta policy requires legal-entity and contact details
              before public launch.
            </p>
          ) : null}
        </section>
        <nav className="mt-8 flex flex-wrap gap-4 border-t border-slate-200 pt-6 text-sm dark:border-slate-800">
          {LEGAL_LINKS.map((link) => (
            <Link
              className="underline underline-offset-4"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </article>
    </main>
  );
}
