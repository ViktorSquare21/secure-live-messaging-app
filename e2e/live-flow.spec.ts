import { expect, test } from './support/fixtures';
import { keyOf, openReceiver, publish, recordTraffic, startSession, type Traffic } from './support/session';

const FIRST_TEXT = 'First live line from the sender';
const SECOND_TEXT = 'Second line replaces the first';

test('the receiver shows two consecutive updates in order without a reload', async ({ senderContext, receiverContext }) => {
  const sender = await startSession(senderContext);
  const receiver = await openReceiver(receiverContext, sender.receiverLink);
  const received = receiver.page.getByRole('region', { name: 'Received text' });

  await expect(sender.page.getByRole('status', { name: 'Receiver status' })).toHaveText('Receiver connected');

  await publish(sender.page, FIRST_TEXT);
  await expect(received).toHaveText(FIRST_TEXT);

  await publish(sender.page, SECOND_TEXT);
  await expect(received).toHaveText(SECOND_TEXT);
  await expect(received).not.toContainText(FIRST_TEXT);

  await expect(receiver.page.getByRole('status', { name: 'Session status' })).toHaveText('Live');
  await expect(receiver.page.getByRole('alert', { name: 'Integrity warning' })).toHaveCount(0);
  await expect(receiver.page.locator('input, textarea, select, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0);
  await expect(receiver.page.getByRole('textbox')).toHaveCount(0);
  expect(receiver.documentLoads()).toBe(1);
  expect(receiver.errors).toEqual([]);
});

test('neither browser sends the key or the plaintext in a request URL or a WebSocket frame', async ({
  senderContext,
  receiverContext,
}) => {
  const traffic: Traffic = { requestUrls: [], sentFrames: [] };
  recordTraffic(senderContext, traffic);
  recordTraffic(receiverContext, traffic);

  const sender = await startSession(senderContext);
  const receiver = await openReceiver(receiverContext, sender.receiverLink);
  const received = receiver.page.getByRole('region', { name: 'Received text' });

  await publish(sender.page, FIRST_TEXT);
  await expect(received).toHaveText(FIRST_TEXT);
  await publish(sender.page, SECOND_TEXT);
  await expect(received).toHaveText(SECOND_TEXT);

  const key = keyOf(sender.receiverLink);
  expect(traffic.sentFrames.length).toBeGreaterThan(0);
  expect(traffic.requestUrls.length).toBeGreaterThan(0);
  for (const secret of [key, FIRST_TEXT, SECOND_TEXT]) {
    expect(traffic.requestUrls.filter((url) => url.includes(secret))).toEqual([]);
    expect(traffic.sentFrames.filter((frame) => frame.includes(secret))).toEqual([]);
  }
});
