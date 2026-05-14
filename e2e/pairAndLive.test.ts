/* eslint-disable jest/expect-expect */
import { by, device, element, waitFor } from 'detox';

describe('pair → live → end', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  it('pairs with the mock server and ends a session', async () => {
    // Manual entry into pairing wizard
    await waitFor(element(by.id('pairing-discovery'))).toBeVisible().withTimeout(10000);
    await element(by.id('pairing-rescan')).tap();

    // Enter manual IP if no auto-found candidate
    await element(by.text('Enter IP address')).tap();
    await element(by.id('pairing-manual-ip')).clearText();
    await element(by.id('pairing-manual-ip')).typeText('localhost:8080');
    await element(by.id('pairing-manual-submit')).tap();

    await waitFor(element(by.id('pairing-trust'))).toBeVisible().withTimeout(15000);
    await element(by.id('pairing-trust-confirm')).tap();

    // Dashboard
    await waitFor(element(by.id('dashboard'))).toBeVisible().withTimeout(15000);
    await element(by.id('dashboard-start-session')).tap();

    // Discipline → Live
    await element(by.id('discipline-confirm')).tap();
    await waitFor(element(by.id('live-session'))).toBeVisible().withTimeout(15000);

    // Wait for ~10 hits to arrive (mock emits one every 1.5s = 15s)
    await new Promise((r) => setTimeout(r, 17000));

    // End session
    await element(by.id('live-end')).tap();
  });
});
