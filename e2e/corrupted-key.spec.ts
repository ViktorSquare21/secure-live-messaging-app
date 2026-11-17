import { expect, test as base } from './support/fixtures';
import { corruptKey, openReceiver, publish, startSession, type ReceiverTab } from './support/session';

const SENDER_TEXT = 'Confidential text the receiver must not see';

const test = base.extend<{ publishedLink: string }>({
  publishedLink: async ({ senderContext }, use) => {
    const sender = await startSession(senderContext);
    await publish(sender.page, SENDER_TEXT);
    await expect(sender.page.getByRole('status', { name: 'Last sent' })).toHaveText(/^Sent at /);
    await use(sender.receiverLink);
  },
});

async function expectNoSenderText(receiver: ReceiverTab): Promise<void> {
  await expect(receiver.page.locator('body')).not.toContainText(SENDER_TEXT);
  expect(await receiver.page.content()).not.toContain(SENDER_TEXT);
  await expect(receiver.page.getByRole('heading', { name: 'Receiver' })).toBeVisible();
  expect(receiver.errors).toEqual([]);
}

test('a truncated key shows the invalid-key error and none of the sender text', async ({
  publishedLink,
  receiverContext,
}) => {
  const receiver = await openReceiver(receiverContext, corruptKey(publishedLink, 'truncated'));

  await expect(receiver.page.getByRole('alert', { name: 'Session error' })).toHaveText(
    'This link is incomplete or damaged. Ask the sender for a new link.',
  );
  await expectNoSenderText(receiver);
});

test('a well-formed but wrong key shows the integrity warning and none of the sender text', async ({
  publishedLink,
  receiverContext,
}) => {
  const receiver = await openReceiver(receiverContext, corruptKey(publishedLink, 'wrong'));

  await expect(receiver.page.getByRole('alert', { name: 'Integrity warning' })).toBeVisible();
  await expect(receiver.page.getByRole('status', { name: 'Session status' })).toHaveText('Update rejected');
  await expect(receiver.page.getByRole('region', { name: 'Received text' })).toHaveText('');
  await expectNoSenderText(receiver);
});
