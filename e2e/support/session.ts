import { expect, type BrowserContext, type Page } from '@playwright/test';

export interface SenderSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly receiverLink: string;
}

export async function startSession(context: BrowserContext): Promise<SenderSession> {
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'New session' }).click();
  await expect(page).toHaveURL(/\/s\/[^/]+$/);
  const linkField = page.getByRole('textbox', { name: 'Receiver link' });
  await expect(linkField).toHaveValue(/\/r\/[^/#]+#.+/);
  return { context, page, receiverLink: await linkField.inputValue() };
}

export async function publish(sender: Page, text: string): Promise<void> {
  await sender.getByRole('textbox', { name: 'Your text' }).fill(text);
}

export interface ReceiverTab {
  readonly page: Page;
  readonly errors: readonly string[];
  readonly documentLoads: () => number;
}

export async function openReceiver(context: BrowserContext, link: string): Promise<ReceiverTab> {
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  let loads = 0;
  page.on('load', () => loads++);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'Receiver' })).toBeVisible();
  return { page, errors, documentLoads: () => loads };
}

export function keyOf(link: string): string {
  const key = new URL(link).hash.slice(1);
  if (key === '') throw new Error('receiver link has no key');
  return key;
}

export type KeyCorruption = 'truncated' | 'wrong';

export function corruptKey(link: string, corruption: KeyCorruption): string {
  const url = new URL(link);
  const key = keyOf(link);
  url.hash = corruption === 'truncated' ? key.slice(0, -5) : invertKey(key);
  return url.toString();
}

function invertKey(key: string): string {
  const bytes = Buffer.from(key, 'base64url');
  if (bytes.length !== 32) throw new Error('receiver link key is not 32 bytes');
  return Buffer.from(bytes.map((byte) => byte ^ 0xff)).toString('base64url');
}

export interface Traffic {
  readonly requestUrls: string[];
  readonly sentFrames: string[];
}

// Attach before the context opens any page, so the first page's socket is recorded too.
export function recordTraffic(context: BrowserContext, traffic: Traffic): void {
  context.on('request', (request) => traffic.requestUrls.push(request.url()));
  context.on('page', (page) =>
    page.on('websocket', (socket) => {
      traffic.requestUrls.push(socket.url());
      socket.on('framesent', ({ payload }) =>
        traffic.sentFrames.push(typeof payload === 'string' ? payload : payload.toString('latin1')),
      );
    }),
  );
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}
