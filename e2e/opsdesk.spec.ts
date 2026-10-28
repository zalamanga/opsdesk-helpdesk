import { test as base, expect, request, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const baseURL = process.env.OPSDESK_BASE_URL || 'http://127.0.0.1:8091';
function password(): string {
  if (process.env.OPSDESK_DEMO_PASSWORD) return process.env.OPSDESK_DEMO_PASSWORD;
  try {
    const match = /^OPSDESK_DEMO_PASSWORD=(.+)$/m.exec(readFileSync('.env', 'utf8'));
    if (match) return match[1].trim();
  } catch { /* CI supplies its isolated demo password through the environment. */ }
  throw new Error('Configure OPSDESK_DEMO_PASSWORD or run scripts/Start.ps1 first');
}
type Storage = Awaited<ReturnType<APIRequestContext['storageState']>>;
const states = new Map<string, Promise<Storage>>();
async function state(role: 'agent' | 'requester'): Promise<Storage> {
  if (!states.has(role)) states.set(role, (async () => {
    const client = await request.newContext({ baseURL });
    try {
      const response = await client.post('/api/auth/login', { data: { email: `${role}@opsdesk.test`, password: password() } });
      expect(response.status(), 'Fixture sign-in must succeed').toBe(200);
      return await client.storageState();
    } finally { await client.dispose(); }
  })());
  return states.get(role)!;
}
const test = base.extend<{ agentPage: Page; requesterPage: Page }>({
  agentPage: async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL, storageState: await state('agent') });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Antrean layanan', exact: true })).toBeVisible();
    await use(page);
    await context.close();
  },
  requesterPage: async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL, storageState: await state('requester') });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Tiket saya', exact: true })).toBeVisible();
    await use(page);
    await context.close();
  },
});

async function post(page: Page, path: string, data: Record<string, unknown>) {
  const me = await (await page.request.get('/api/auth/me')).json();
  return page.request.post(`/api${path}`, { data, headers: { 'X-CSRF-Token': me.csrf_token } });
}
async function create(page: Page, label: string) {
  const response = await post(page, '/tickets', {
    title: `[Training, browser] ${label} ${randomUUID().slice(0, 6)}`,
    description: 'Data latihan otomatis untuk memeriksa workflow, bukan insiden perusahaan nyata.',
    category: 'network', priority: 'high',
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function open(page: Page, ticket: { id: number; title: string }) {
  await page.goto(`/#ticket/${ticket.id}`);
  await expect(page.getByTestId('ticket-detail').getByRole('heading', { name: ticket.title, exact: true })).toBeVisible();
}
async function action(page: Page, suffix: string, click: () => Promise<unknown>, status = 200) {
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname.endsWith(suffix) && r.request().method() === 'POST'),
    click(),
  ]);
  expect(response.status()).toBe(status);
  return response.json();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('real sign-in, invalid password, keyboard form and session revocation', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('agent2@opsdesk.test');
  await page.getByLabel('Kata sandi', { exact: true }).fill('deliberately-wrong-password');
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect');
  await page.getByLabel('Kata sandi', { exact: true }).fill(password());
  await page.getByLabel('Kata sandi', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Antrean layanan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Buat tiket', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Buat tiket', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Masuk ke meja layanan' })).toBeVisible();
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
});

test('requester creates a persisted ticket with server SLA and reloads its detail', async ({ requesterPage: page }) => {
  const title = `[Training, browser] Akses VPN baru ${randomUUID().slice(0, 6)}`;
  await page.getByRole('button', { name: 'Buat tiket', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Judul kendala').fill(title);
  await dialog.getByLabel('Deskripsi', { exact: true }).fill('VPN pada laptop latihan belum bisa terhubung setelah profil jaringan diperbarui.');
  await dialog.getByRole('combobox', { name: 'Kategori', exact: true }).selectOption('network');
  await dialog.getByRole('combobox', { name: 'Prioritas', exact: true }).selectOption('critical');
  await expect(dialog).toContainText('15 menit');
  const created = await action(page, '/api/tickets', () => dialog.getByRole('button', { name: 'Kirim tiket' }).click(), 201);
  expect(new Date(created.response_due_at).getTime() - new Date(created.created_at).getTime()).toBe(15 * 60_000);
  await expect(page.getByTestId('ticket-detail').getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('ticket-detail')).toContainText(title);
  await expect(page.getByLabel('Catatan internal, hanya untuk agen')).toHaveCount(0);
});

test('assignment, internal/public reply, resolution and requester reopen use the real API', async ({ agentPage: agent, requesterPage: requester }) => {
  const ticket = await create(requester, 'Workflow lengkap');
  const me = await (await agent.request.get('/api/auth/me')).json();
  await open(agent, ticket);
  const panel = agent.getByTestId('ticket-detail');
  await panel.getByRole('combobox', { name: 'Agen penanggung jawab' }).selectOption(String(me.user.id));
  await action(agent, '/assign', () => panel.getByRole('button', { name: 'Simpan penugasan' }).click());
  await action(agent, '/transition', () => panel.getByRole('button', { name: 'Mulai kerjakan' }).click());
  await panel.getByRole('textbox', { name: 'Pesan', exact: true }).fill('Catatan rahasia latihan: periksa log gateway internal.');
  await panel.getByLabel('Catatan internal, hanya untuk agen').check();
  const internal = await action(agent, '/comments', () => panel.getByRole('button', { name: 'Simpan catatan internal' }).click());
  expect(internal.first_response_at).toBeNull();
  await panel.getByLabel('Catatan internal, hanya untuk agen').uncheck();
  await panel.getByRole('textbox', { name: 'Pesan', exact: true }).fill('Profil VPN sudah diperiksa. Silakan coba koneksi menggunakan profil yang baru.');
  const replied = await action(agent, '/comments', () => panel.getByRole('button', { name: 'Kirim balasan' }).click());
  expect(replied.response_sla.state).toBe('met');
  await panel.getByLabel('Ringkasan solusi', { exact: true }).fill('Profil VPN diperbarui dan sambungan berhasil diuji bersama pemohon latihan.');
  const resolved = await action(agent, '/transition', () => panel.getByRole('button', { name: 'Selesaikan tiket' }).click());
  expect(resolved.status).toBe('resolved');
  await open(requester, ticket);
  const customerPanel = requester.getByTestId('ticket-detail');
  await expect(customerPanel).not.toContainText('Catatan rahasia latihan');
  const visible = await (await requester.request.get(`/api/tickets/${ticket.id}`)).json();
  expect(visible.comments.every((x: { internal: boolean }) => !x.internal)).toBe(true);
  await customerPanel.getByLabel('Alasan dibuka kembali').fill('Koneksi berhasil sebentar, tetapi kendala yang sama muncul kembali pada laptop latihan.');
  const reopened = await action(requester, '/transition', () => customerPanel.getByRole('button', { name: 'Buka kembali', exact: true }).click());
  expect(reopened.status).toBe('open');
  expect(reopened.resolution_due_at).toBe(ticket.resolution_due_at);
  expect(reopened.first_response_at).toBe(replied.first_response_at);
});

test('stale write is rejected and reload preserves an unsent reply', async ({ agentPage: agent, requesterPage: requester }) => {
  const ticket = await create(requester, 'Konflik dua perubahan');
  await open(agent, ticket);
  const panel = agent.getByTestId('ticket-detail');
  const draft = 'Draf ini harus tetap ada setelah versi terbaru dimuat.';
  await panel.getByRole('textbox', { name: 'Pesan', exact: true }).fill(draft);
  const concurrent = await post(requester, `/tickets/${ticket.id}/comments`, { body: 'Informasi tambahan dari pemohon latihan.', internal: false, expected_version: ticket.version });
  expect(concurrent.status()).toBe(200);
  await action(agent, '/comments', () => panel.getByRole('button', { name: 'Kirim balasan' }).click(), 409);
  await expect(panel.getByRole('button', { name: 'Muat versi terbaru' })).toBeVisible();
  let finishReload!: () => void;
  const reloadGate = new Promise<void>(resolve => { finishReload = resolve; });
  await agent.route(`**/api/tickets/${ticket.id}`, async route => { await reloadGate; await route.continue(); });
  await panel.getByRole('button', { name: 'Muat versi terbaru' }).click();
  try { await expect(panel.getByRole('button', { name: 'Kirim balasan' })).toBeDisabled(); }
  finally { finishReload(); }
  await expect(panel).toContainText('Versi terbaru dimuat.');
  await agent.unroute(`**/api/tickets/${ticket.id}`);
  await expect(panel.getByRole('textbox', { name: 'Pesan', exact: true })).toHaveValue(draft);
  await action(agent, '/comments', () => panel.getByRole('button', { name: 'Kirim balasan' }).click());
  await expect(panel).toContainText(draft);
});

test('search, all filters, CSV and true pagination work on persisted records', async ({ agentPage: page, requesterPage }) => {
  const ticket = await create(requesterPage, 'Filter dan halaman');
  await page.getByRole('button', { name: 'Perbarui', exact: true }).click();
  await page.getByLabel('Cari tiket', { exact: true }).fill(ticket.title);
  await page.getByRole('button', { name: 'Cari', exact: true }).click();
  await expect(page.getByTestId(`ticket-${ticket.id}`)).toBeVisible();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('open');
  await page.getByRole('combobox', { name: 'Prioritas', exact: true }).selectOption('high');
  await page.getByRole('combobox', { name: 'Penugasan', exact: true }).selectOption('unassigned');
  await page.getByRole('combobox', { name: 'SLA', exact: true }).selectOption('all');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Ekspor CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('opsdesk-tickets.csv');
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream!) csv += chunk.toString();
  expect(csv).toContain(ticket.title);
  await page.getByRole('combobox', { name: 'SLA', exact: true }).selectOption('breached');
  await expect(page.getByRole('heading', { name: 'Tidak ada tiket yang cocok' })).toBeVisible();
  await page.getByRole('button', { name: 'Hapus filter' }).click();
  await page.getByRole('combobox', { name: 'Tiket per halaman' }).selectOption('10');
  await expect(page.getByRole('button', { name: 'Berikutnya', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Halaman antrean' })).toContainText('Halaman 2');
  await page.getByRole('button', { name: 'Sebelumnya', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Halaman antrean' })).toContainText('Halaman 1');
});

test('mobile queue, detail, back and keyboard dialog stay within the viewport', async ({ agentPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.locator('[data-testid^="ticket-"]').first().click();
  await expect(page.getByTestId('ticket-detail')).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Kembali ke antrean' }).click();
  await expect(page.getByRole('heading', { name: 'Antrean layanan', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Buat tiket', exact: true }).click();
  await noOverflow(page);
  await expect(page.getByLabel('Judul kendala')).toBeFocused();
  await page.getByRole('button', { name: 'Batal', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('network error retains prior queue and retry recovers; loading is visible', async ({ agentPage: page }) => {
  await expect(page.locator('[data-testid^="ticket-"]').first()).toBeVisible();
  await page.route('**/api/tickets?*', route => route.abort('failed'));
  await page.getByRole('button', { name: 'Perbarui', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Data terakhir masih ditampilkan');
  await page.unroute('**/api/tickets?*');
  await page.getByRole('button', { name: 'Coba lagi', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/tickets?*', async route => { await gate; await route.continue(); });
  await page.getByRole('button', { name: 'Perbarui', exact: true }).click();
  try { await expect(page.getByRole('button', { name: 'Memuat...', exact: true })).toBeVisible(); }
  finally { release(); }
  await expect(page.getByRole('button', { name: 'Perbarui', exact: true })).toBeEnabled();
});

test('rendered text contrast and 320/390/768/1440 reflow remain readable', async ({ agentPage: agent, page }) => {
  async function checkContrast(target: Page) {
    const result = await target.evaluate(() => {
      const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const luminance = (color: number[]) => color.map(v => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const root = document.querySelector('dialog[open]') || document.body;
      const violations: { tag: string; text: string; ratio: number }[] = [];
      let checked = 0;
      let minimum = Infinity;
      for (const node of root.querySelectorAll<HTMLElement>('*')) {
        if (!node.getClientRects().length || ![...node.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue;
        const style = getComputedStyle(node);
        if (style.visibility === 'hidden' || node.closest('button:disabled, select:disabled, input:disabled')) continue;
        let parent: Element | null = node;
        let background = [255, 255, 255];
        while (parent) {
          const value = getComputedStyle(parent).backgroundColor;
          if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { background = rgb(value); break; }
          parent = parent.parentElement;
        }
        const foreground = rgb(style.color);
        if (foreground.length !== 3 || background.length !== 3) continue;
        const a = luminance(foreground), b = luminance(background);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        checked++;
        minimum = Math.min(minimum, ratio);
        if (ratio < (large ? 3 : 4.5)) violations.push({ tag: node.tagName, text: (node.textContent || '').trim().slice(0, 65), ratio });
      }
      return { checked, minimum, violations };
    });
    expect(result.checked).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Masuk ke meja layanan' })).toBeVisible();
  await checkContrast(page);
  await expect(agent.locator('[data-testid^="ticket-"]').first()).toBeVisible();
  for (const width of [1440, 768, 390, 320]) {
    await agent.setViewportSize({ width, height: 900 });
    await noOverflow(agent);
    await checkContrast(agent);
  }
  await agent.setViewportSize({ width: 1440, height: 1000 });
  const queue = await (await agent.request.get('/api/tickets?q=Printer')).json();
  await open(agent, queue.items[0]);
  await checkContrast(agent);
  await agent.getByRole('button', { name: 'Buat tiket', exact: true }).click();
  await checkContrast(agent);
  await agent.getByRole('button', { name: 'Tutup', exact: true }).click();
});

test('@capture real desktop and mobile product screens', async ({ agentPage: agent, requesterPage: requester, page }) => {
  const folder = resolve('docs/screenshots');
  mkdirSync(folder, { recursive: true });
  await agent.setViewportSize({ width: 1440, height: 1000 });
  await agent.goto('/');
  await expect(agent.getByText('[Training] VPN tidak bisa terhubung', { exact: true })).toBeVisible();
  await agent.screenshot({ path: resolve(folder, '01-queue.png'), fullPage: false });
  const queue = await (await agent.request.get('/api/tickets?q=Printer')).json();
  await open(agent, queue.items[0]);
  await agent.setViewportSize({ width: 1440, height: 1280 });
  await agent.getByRole('heading', { name: 'Batas waktu penanganan' }).click();
  await agent.evaluate(() => window.scrollTo(0, 0));
  await agent.screenshot({ path: resolve(folder, '02-ticket.png'), fullPage: false });
  await requester.setViewportSize({ width: 1440, height: 1000 });
  await requester.goto('/');
  await expect(requester.getByRole('heading', { name: 'Tiket saya', exact: true })).toBeVisible();
  await requester.screenshot({ path: resolve(folder, '03-requester.png'), fullPage: false });
  await agent.setViewportSize({ width: 390, height: 844 });
  await open(agent, queue.items[0]);
  await agent.getByRole('heading', { name: 'Batas waktu penanganan' }).click();
  await noOverflow(agent);
  await agent.screenshot({ path: resolve(folder, '04-mobile.png'), fullPage: false });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Masuk ke meja layanan' })).toBeVisible();
  await page.screenshot({ path: resolve(folder, '05-login.png'), fullPage: false });
});
