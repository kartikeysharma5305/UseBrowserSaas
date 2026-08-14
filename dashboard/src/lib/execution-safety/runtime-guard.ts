import { assertStaticUrlAllowed, parseSafetyUrl } from './domain-policy';
import {
  assertPublicResolution,
  type AddressResolver,
  systemAddressResolver,
} from './network';
import type { ExecutionSafetyPolicy } from './types';
import { SafetyPolicyError } from './types';

const PAYMENT_PATTERN =
  /\b(buy|checkout|pay(?:ment)?|purchase|place order|confirm order|transfer money|card number|billing)\b/i;
const DESTRUCTIVE_PATTERN =
  /\b(delete|remove|terminate|cancel (?:account|subscription)|publish|final submit|submit final|permission|irreversible)\b/i;
const SUBMIT_PATTERN =
  /\b(submit|send|confirm|save|publish|apply|register|sign up)\b/i;

function nodeDescription(node: unknown) {
  if (!node || typeof node !== 'object') return '';
  const value = node as Record<string, unknown>;
  const attributes =
    value.attributes && typeof value.attributes === 'object'
      ? Object.values(value.attributes as Record<string, unknown>).join(' ')
      : '';
  return [value.tag_name, value.inner_text, value.text, attributes]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1000);
}

export class ExecutionSafetyGuard {
  private navigations = 0;
  private readonly initialHostname: string;
  private lastNavigationUrl: string | null = null;
  private pendingFailure: SafetyPolicyError | null = null;
  private readonly sensitiveInputCounts = new Map<string, number>();

  constructor(
    readonly policy: ExecutionSafetyPolicy,
    initialTarget: string,
    private readonly resolver: AddressResolver = systemAddressResolver
  ) {
    this.initialHostname = parseSafetyUrl(initialTarget).hostname;
  }

  async assertNavigation(
    url: string,
    kind: 'initial' | 'navigation' | 'redirect' = 'navigation'
  ) {
    const parsed = assertStaticUrlAllowed(url, this.policy);
    if (
      kind === 'redirect' &&
      this.policy.redirectPolicy === 'SAME_DOMAIN' &&
      parsed.hostname !== this.initialHostname
    )
      throw new SafetyPolicyError('REDIRECT_BLOCKED');
    const identity = `${parsed.url.protocol}//${parsed.url.host}${parsed.url.pathname}`;
    if (identity !== this.lastNavigationUrl) {
      this.navigations += 1;
      if (this.navigations > this.policy.maxNavigations)
        throw new SafetyPolicyError('NAVIGATION_LIMIT_EXCEEDED');
      this.lastNavigationUrl = identity;
    }
    await assertPublicResolution(parsed.hostname, this.resolver);
  }

  assertPageCount(count: number) {
    if (count > this.policy.maxPages)
      throw new SafetyPolicyError('PAGE_LIMIT_EXCEEDED');
  }

  async assertBrowserNavigationRequest(url: string) {
    const parsed = parseSafetyUrl(url);
    const identity = `${parsed.url.protocol}//${parsed.url.host}${parsed.url.pathname}`;
    await this.assertNavigation(
      url,
      identity === this.lastNavigationUrl ? 'navigation' : 'redirect'
    );
  }

  recordFailure(error: SafetyPolicyError) {
    this.pendingFailure ??= error;
  }

  throwPendingFailure() {
    if (!this.pendingFailure) return;
    const error = this.pendingFailure;
    this.pendingFailure = null;
    throw error;
  }

  assertClick(node: unknown) {
    const description = nodeDescription(node);
    if (PAYMENT_PATTERN.test(description))
      throw new SafetyPolicyError('PAYMENT_ACTION_BLOCKED');
    if (
      !this.policy.allowDestructiveActions &&
      DESTRUCTIVE_PATTERN.test(description)
    )
      throw new SafetyPolicyError('DESTRUCTIVE_ACTION_BLOCKED');
    if (
      this.policy.formSubmissionMode === 'BLOCKED' &&
      SUBMIT_PATTERN.test(description)
    )
      throw new SafetyPolicyError('FORM_SUBMISSION_BLOCKED');
    if (
      this.policy.formSubmissionMode === 'SAFE_ONLY' &&
      (PAYMENT_PATTERN.test(description) ||
        DESTRUCTIVE_PATTERN.test(description))
    )
      throw new SafetyPolicyError('FORM_SUBMISSION_BLOCKED');
  }

  assertFormInput(value: unknown, sensitiveValues: readonly string[] = []) {
    if (this.policy.formSubmissionMode === 'BLOCKED')
      throw new SafetyPolicyError('FORM_SUBMISSION_BLOCKED');
    if (typeof value !== 'string') return;
    const secret = sensitiveValues.find(
      (candidate) => candidate.length > 0 && candidate === value
    );
    if (!secret) return;
    const count = this.sensitiveInputCounts.get(secret) ?? 0;
    if (count >= 1) throw new SafetyPolicyError('CREDENTIAL_RETRY_BLOCKED');
    this.sensitiveInputCounts.set(secret, count + 1);
  }
}

type SessionLike = Record<string, unknown> & {
  browser_context?: BrowserContextLike | null;
};

type BrowserContextLike = {
  pages?: () => PageLike[];
  route?: (
    pattern: string,
    handler: (route: RouteLike) => Promise<void>
  ) => Promise<void>;
  on?: (event: string, handler: (page: PageLike) => void) => void;
};

type PageLike = {
  url?: () => string;
  on?: (event: string, handler: (download: DownloadLike) => void) => void;
  close?: () => Promise<void>;
  route?: (
    pattern: string,
    handler: (route: RouteLike) => Promise<void>
  ) => Promise<void>;
  context?: () => {
    newCDPSession?: (page: PageLike) => Promise<CdpSessionLike>;
  };
};

type CdpSessionLike = {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  on: (
    event: string,
    handler: (payload: {
      requestId: string;
      request?: { url?: string };
    }) => void
  ) => void;
};

type DownloadLike = { cancel?: () => Promise<void> };
type RouteLike = {
  request: () => {
    url: () => string;
    isNavigationRequest?: () => boolean;
  };
  abort: (code?: string) => Promise<void>;
  continue: () => Promise<void>;
};

export function installExecutionSafetyGuard(
  session: SessionLike,
  guard: ExecutionSafetyGuard,
  sensitiveValues: readonly string[] = []
) {
  const guardedPages = new WeakSet<object>();
  let hookedContext: BrowserContextLike | null = null;

  const guardNavigationRoute = async (route: RouteLike) => {
    const request = route.request();
    if (request.isNavigationRequest?.()) {
      try {
        await guard.assertBrowserNavigationRequest(request.url());
      } catch (error) {
        if (error instanceof SafetyPolicyError) {
          guard.recordFailure(error);
          await route.abort('blockedbyclient');
          return;
        }
        throw error;
      }
    }
    await route.continue();
  };

  const guardPage = async (page: PageLike) => {
    if (!page || guardedPages.has(page as object)) return;
    guardedPages.add(page as object);
    page.on?.('download', (download) => {
      void download.cancel?.().catch(() => undefined);
      guard.recordFailure(new SafetyPolicyError('DOWNLOAD_BLOCKED'));
    });
    await page.route?.('**/*', guardNavigationRoute);
    const cdp = await page.context?.().newCDPSession?.(page);
    if (cdp) {
      cdp.on('Fetch.requestPaused', (payload) => {
        void (async () => {
          try {
            await guard.assertBrowserNavigationRequest(
              String(payload.request?.url ?? '')
            );
            await cdp.send('Fetch.continueRequest', {
              requestId: payload.requestId,
            });
          } catch (error) {
            if (!(error instanceof SafetyPolicyError)) throw error;
            guard.recordFailure(error);
            await cdp.send('Fetch.failRequest', {
              requestId: payload.requestId,
              errorReason: 'BlockedByClient',
            });
          }
        })();
      });
      await cdp.send('Fetch.enable', {
        patterns: [
          {
            urlPattern: '*',
            resourceType: 'Document',
            requestStage: 'Request',
          },
        ],
      });
    }
  };

  const installContextHooks = async () => {
    const context = session.browser_context ?? null;
    if (!context || context === hookedContext) return;
    hookedContext = context;
    await Promise.all((context.pages?.() ?? []).map(guardPage));
    context.on?.('page', (page) => {
      void guardPage(page);
      try {
        guard.assertPageCount(context.pages?.().length ?? 1);
      } catch (error) {
        if (error instanceof SafetyPolicyError) guard.recordFailure(error);
        void page.close?.().catch(() => undefined);
      }
    });
    await context.route?.('**/*', guardNavigationRoute);
  };

  const ensureCurrentPageGuarded = async () => {
    const getCurrentPage = session.get_current_page;
    if (typeof getCurrentPage === 'function')
      await (getCurrentPage as () => Promise<unknown>).call(session);
    await installContextHooks();
  };

  const wrap = (
    name: string,
    replacement: (
      original: (...args: unknown[]) => unknown,
      args: unknown[]
    ) => unknown
  ) => {
    const original = session[name];
    if (typeof original !== 'function') return;
    session[name] = function (this: SessionLike, ...args: unknown[]) {
      return replacement(
        original.bind(this) as (...args: unknown[]) => unknown,
        args
      );
    };
  };

  wrap('navigate_to', async (original, args) => {
    await guard.assertNavigation(String(args[0] ?? ''));
    await ensureCurrentPageGuarded();
    try {
      const result = await original(...args);
      guard.throwPendingFailure();
      return result;
    } catch (error) {
      guard.throwPendingFailure();
      throw error;
    }
  });
  wrap('create_new_tab', async (original, args) => {
    guard.assertPageCount((session.browser_context?.pages?.().length ?? 0) + 1);
    await guard.assertNavigation(String(args[0] ?? ''));
    await installContextHooks();
    try {
      const result = await original(...args);
      guard.throwPendingFailure();
      return result;
    } catch (error) {
      guard.throwPendingFailure();
      throw error;
    }
  });
  wrap('validate_page_after_action', async (original, args) => {
    await installContextHooks();
    guard.throwPendingFailure();
    const result = await original(...args);
    const page = args[0] as { url?: () => string } | null;
    const current = page?.url?.();
    if (current && current !== 'about:blank')
      await guard.assertNavigation(current, 'redirect');
    guard.assertPageCount(session.browser_context?.pages?.().length ?? 1);
    guard.throwPendingFailure();
    return result;
  });
  for (const name of ['_click_element_node', 'perform_click']) {
    wrap(name, async (original, args) => {
      guard.assertClick(args[0]);
      try {
        const result = await original(...args);
        guard.throwPendingFailure();
        return result;
      } catch (error) {
        guard.throwPendingFailure();
        throw error;
      }
    });
  }
  wrap('_input_text_element_node', async (original, args) => {
    guard.assertFormInput(args[1], sensitiveValues);
    return original(...args);
  });
  wrap('upload_file', async () => {
    throw new SafetyPolicyError('UPLOAD_BLOCKED');
  });
  wrap('start', async (original, args) => {
    const result = await original(...args);
    await installContextHooks();
    return result;
  });
}
