import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { publish, recordTraffic, startSession, type Traffic } from './support/session';

const TEXT = 'Typed under the production Content Security Policy';
const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

interface CspWatch {
  readonly console: string[];
  readonly violations: (page: Page) => Promise<string[]>;
}

// Playwright evaluates init scripts outside the page's CSP, so the listener runs even under script-src 'self'.
async function watchCsp(context: BrowserContext): Promise<CspWatch> {
  await context.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) => seen.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  const consoleMessages: string[] = [];
  context.on('console', (message) => {
    if (/content security policy/i.test(message.text())) consoleMessages.push(message.text());
  });
  return {
    console: consoleMessages,
    violations: (page) => page.evaluate(() => [...((window as unknown as { __cspViolations: string[] }).__cspViolations ?? [])]),
  };
}

test('the sender-to-receiver flow works on the production build with no CSP violation and no other host', async ({
  senderContext,
  receiverContext,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? '').origin;
  const traffic: Traffic = { requestUrls: [], sentFrames: [] };
  recordTraffic(senderContext, traffic);
  recordTraffic(receiverContext, traffic);
  const senderCsp = await watchCsp(senderContext);
  const receiverCsp = await watchCsp(receiverContext);

  const sender = await startSession(senderContext);
  expect(new URL(sender.receiverLink).origin).toBe(origin);

  const receiverPage = await receiverContext.newPage();
  const navigation = await receiverPage.goto(sender.receiverLink);
  expect(navigation?.status()).toBe(200);
  expect(navigation?.headers()['content-security-policy']).toBe(EXPECTED_CSP);
  expect(navigation?.headers()['referrer-policy']).toBe('no-referrer');
  expect(navigation?.headers()['x-content-type-options']).toBe('nosniff');
  expect(navigation?.headers()['cache-control']).toBe('no-store');

  await expect(sender.page.getByRole('status', { name: 'Receiver status' })).toHaveText('Receiver connected');
  await publish(sender.page, TEXT);
  await expect(receiverPage.getByRole('region', { name: 'Received text' })).toHaveText(TEXT);
  await expect(receiverPage.getByRole('status', { name: 'Session status' })).toHaveText('Live');

  expect(await senderCsp.violations(sender.page)).toEqual([]);
  expect(await receiverCsp.violations(receiverPage)).toEqual([]);
  expect(senderCsp.console).toEqual([]);
  expect(receiverCsp.console).toEqual([]);

  expect(traffic.requestUrls.length).toBeGreaterThan(0);
  for (const url of traffic.requestUrls) {
    const parsed = new URL(url);
    expect(parsed.host, url.split('#')[0]).toBe(new URL(origin).host);
  }
});
