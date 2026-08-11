import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' }
)
  .split(/\r?\n/)
  .filter(Boolean)
  .filter(
    (file) =>
      !/(?:^|\/)(?:node_modules|\.next|dist|coverage)(?:\/|$)/.test(file) &&
      !/(?:pnpm-lock\.yaml|\.env\.example|^test\/)/.test(file)
  );

const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['live Stripe secret', /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/],
  ['live application API key', /\bbua_live_[a-f0-9]{16}\.[A-Za-z0-9_-]{40,}\b/],
  ['NVIDIA API key', /\bnvapi-[A-Za-z0-9_-]{20,}\b/],
  ['webhook signing secret', /\bwhsec_[A-Za-z0-9_-]{24,}\b/],
];

const findings = [];
for (const file of files) {
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const [kind, pattern] of patterns) {
    if (pattern.test(source)) findings.push(`${file}: ${kind}`);
  }
}

const trackedEnvironmentFiles = files.filter(
  (file) => /(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.example')
);
for (const file of trackedEnvironmentFiles)
  findings.push(`${file}: unsafe tracked environment file`);

if (findings.length) {
  console.error('Security secret scan failed (values intentionally omitted):');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Security secret scan passed (${files.length} files inspected).`);
}
