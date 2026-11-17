import { expect, test, type Page } from '@playwright/test';

const PAGES = ['/', '/features', '/solutions', '/pricing', '/videos', '/book-demo', '/contact', '/free-trial', '/about', '/faq', '/privacy', '/terms', '/login'];

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(0);
}

test.describe('public website', () => {
  for (const path of PAGES) {
    test(`renders ${path} without errors or horizontal overflow`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(path);
      await expect(page.locator('h1').first()).toBeVisible();
      await noHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  }

  for (const width of [320, 768, 1024, 1440]) {
    test(`home and pricing fit a ${width}px viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/', '/pricing', '/book-demo']) {
        await page.goto(path);
        await expect(page.locator('h1').first()).toBeVisible();
        await noHorizontalOverflow(page);
      }
    });
  }

  test('sets per-page SEO titles and descriptions', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveTitle(/Pricing \| HRMS Cloud/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Indian Rupees/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/pricing$/);
  });

  test('switches to Tamil without reloading and remembers the choice', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 42));
    await page.getByRole('button', { name: 'Change language' }).click();
    await page.getByRole('menuitem', { name: 'தமிழ்' }).click();
    await expect(page.locator('h1')).toContainText('தமிழிலும்');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ta');
    expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(42); // no reload happened
    await page.reload();
    await expect(page.locator('h1')).toContainText('தமிழிலும்');
  });

  test('persists the chosen theme across reloads', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Change theme' }).click();
    await page.getByRole('menuitem', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Change theme' }).click();
    await page.getByRole('menuitem', { name: 'Light' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('WhatsApp buttons use official wa.me links with a prefilled message', async ({ page }) => {
    await page.goto('/');
    const floating = page.getByRole('link', { name: 'Chat with us on WhatsApp' });
    await expect(floating).toBeVisible();
    const href = await floating.getAttribute('href');
    expect(href).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(decodeURIComponent(href!.split('text=')[1])).toContain('HRMS Cloud');
    await expect(floating).toHaveAttribute('target', '_blank');
  });

  test('mobile navigation opens and navigates', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'mobile only');
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('protected areas redirect to sign in', async ({ page }) => {
    await page.goto('/admin/leads');
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/portal/branding');
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe('forms (API mocked)', () => {
  test('contact form validates and submits an enquiry', async ({ page }) => {
    let payload: Record<string, unknown> | null = null;
    await page.route('**/api/public/leads', async (route) => {
      payload = route.request().postDataJSON();
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto('/contact');
    await page.getByRole('button', { name: 'Send enquiry' }).click();
    await expect(page.getByText('This field is required').first()).toBeVisible();
    await expect(page.getByText('Please agree to continue')).toBeVisible();

    await page.getByLabel('Your name').fill('Priya Raman');
    await page.getByLabel('Company name').fill('Sri Murugan Textiles');
    await page.getByLabel('Mobile number').fill('12345');
    await page.getByRole('button', { name: 'Send enquiry' }).click();
    await expect(page.getByText('Enter a valid 10-digit Indian mobile number')).toBeVisible();

    await page.getByLabel('Mobile number').fill('98765 43210');
    await page.getByLabel(/agree to be contacted/).check();
    await page.waitForTimeout(1600); // human-speed submission (bots are rejected server-side)
    await page.getByRole('button', { name: 'Send enquiry' }).click();
    await expect(page.getByText('Thank you!')).toBeVisible();
    expect(payload).toMatchObject({ company_name: 'Sri Murugan Textiles', phone: '98765 43210', consent: true, source: 'contact_form', language: 'en' });
    expect(payload!.website ?? '').toBe('');
  });

  test('books a demo in an available slot and handles a taken slot', async ({ page }) => {
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const slot1 = `${day}T04:30:00.000Z`;
    const slot2 = `${day}T05:15:00.000Z`;
    let attempts = 0;
    await page.route('**/api/public/demo-slots**', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Kolkata', days: [{ date: day, slots: [{ starts_at: slot1, ends_at: slot2 }, { starts_at: slot2, ends_at: `${day}T06:00:00.000Z` }] }] } }),
    );
    await page.route('**/api/public/demo-bookings', async (route) => {
      attempts++;
      const body = route.request().postDataJSON();
      if (body.starts_at === slot1) return route.fulfill({ status: 409, json: { error: { code: 'slot_unavailable', message: 'taken' } } });
      return route.fulfill({ json: { ok: true, booking: { starts_at: body.starts_at, ends_at: `${day}T06:00:00.000Z`, manage_token: 'a'.repeat(64), mode: 'online' } } });
    });

    await page.goto('/book-demo');
    // 10:00 AM IST == 04:30 UTC — times are displayed in Asia/Kolkata.
    await page.getByRole('radio', { name: /10:00\s?am/i }).click();
    await page.getByLabel('Your name').fill('Priya');
    await page.getByLabel('Company name').fill('Acme Textiles');
    await page.getByLabel('Mobile number').fill('9876543210');
    await page.getByRole('textbox', { name: 'Email' }).fill('priya@acme.test');
    await page.getByLabel(/agree to be contacted/).check();
    await page.waitForTimeout(1600);
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByText('That time is no longer available')).toBeVisible();

    await page.getByRole('radio', { name: /10:45\s?am/i }).click();
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByText('Your demo is booked!')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reschedule or cancel' })).toHaveAttribute('href', `/demo/manage/${'a'.repeat(64)}`);
    expect(attempts).toBe(2);
  });

  test('free trial form enforces password rules', async ({ page }) => {
    await page.goto('/free-trial');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create my account' }).click();
    await expect(page.getByText('Use at least 8 characters')).toBeVisible();
  });
});
