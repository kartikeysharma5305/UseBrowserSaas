import { getEmailConfiguration } from './config';
import type { EmailTemplate } from './templates';

export interface EmailSendInput extends EmailTemplate {
  to: string;
  idempotencyKey: string;
}

export interface EmailProvider {
  send(input: EmailSendInput): Promise<{ messageId: string }>;
}

export class DevelopmentEmailProvider implements EmailProvider {
  async send(input: EmailSendInput) {
    return { messageId: `development-${input.idempotencyKey.slice(0, 80)}` };
  }
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string
  ) {}

  async send(input: EmailSendInput) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!response.ok) throw new Error(`EMAIL_PROVIDER_${response.status}`);
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string')
      throw new Error('EMAIL_PROVIDER_INVALID_RESPONSE');
    return { messageId: body.id.slice(0, 160) };
  }
}

export function createEmailProvider(): EmailProvider | null {
  const config = getEmailConfiguration();
  if (!config.enabled) return null;
  return config.provider === 'development'
    ? new DevelopmentEmailProvider()
    : new ResendEmailProvider(config.apiKey!, config.from!);
}
