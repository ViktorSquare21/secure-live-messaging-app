import { test as base, type BrowserContext } from '@playwright/test';

export const test = base.extend<{ senderContext: BrowserContext; receiverContext: BrowserContext }>({
  senderContext: async ({ browser }, use) => {
    const context = await browser.newContext();
    await use(context);
    await context.close();
  },
  receiverContext: async ({ browser }, use) => {
    const context = await browser.newContext();
    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';
