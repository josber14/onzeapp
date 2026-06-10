import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import type { ChatMessage } from './types';

const STATE_FILE = path.resolve(process.cwd(), '.p2p-chat-state.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let globalBrowser: Browser | null = null;
let globalCtx: BrowserContext | null = null;
let globalTenantId: number = 0;

async function saveCookiesToDb(tenantId: number, ctx: BrowserContext): Promise<void> {
  try {
    const state = await ctx.storageState();
    const cookieStr = state.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const { storeCookies } = await import('./chat-browser');
    await storeCookies(tenantId, cookieStr);
  } catch {}
}

function parseCookies(cookieStr: string): { name: string; value: string; domain: string; path: string }[] {
  const pairs = cookieStr.split(';').map(s => s.trim()).filter(Boolean);
  const cookies: { name: string; value: string; domain: string; path: string }[] = [];
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const name = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();
    if (name) cookies.push({ name, value, domain: '.binance.com', path: '/' });
  }
  return cookies;
}

async function getBrowser(tenantId?: number): Promise<{ browser: Browser; ctx: BrowserContext }> {
  if (globalBrowser && globalCtx) {
    try {
      await globalBrowser.contexts();
      return { browser: globalBrowser, ctx: globalCtx };
    } catch {
      // Browser died, re-launch
      globalBrowser = null;
      globalCtx = null;
    }
  }

  const launchOpts: any = {
    headless: true,
    args: [
      '--headless=new',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--window-size=1366,900',
    ],
  };
  launchOpts.channel = 'chrome';

  try {
    globalBrowser = await chromium.launch(launchOpts);
  } catch {
    delete launchOpts.channel;
    globalBrowser = await chromium.launch(launchOpts);
  }

  globalCtx = await globalBrowser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent: UA,
    locale: 'es-CL',
    deviceScaleFactor: 2,
    timezoneId: 'America/Santiago',
    geolocation: { latitude: -33.4489, longitude: -70.6693 },
    permissions: [],
  });

  // Inject cookies
  if (tenantId) {
    const { getStoredCookies } = await import('./chat-browser');
    const cookies = await getStoredCookies(tenantId);
    if (cookies) {
      const parsed = parseCookies(cookies);
      if (parsed.length > 0) {
        await globalCtx.addCookies(parsed);
      }
    }
    globalTenantId = tenantId;
  }

  // Refresh cookies in background
  if (globalTenantId) {
    saveCookiesToDb(globalTenantId, globalCtx).catch(() => {});
  }

  return { browser: globalBrowser, ctx: globalCtx };
}

async function doSend(
  orderNumber: string,
  message: string,
  createdAt?: number
): Promise<{ ok: boolean; error?: string }> {
  let p: Page | null = null;

  try {
    const { ctx } = await getBrowser(globalTenantId || undefined);
    p = await ctx.newPage();

    // Try URLs to find the right chat page
    const ts = createdAt ?? Date.now();
    for (const url of [
      `https://c2c.binance.com/es/fiatOrderDetail?orderNo=${orderNumber}&createdAt=${ts}`,
      `https://c2c.binance.com/es/fiatOrderDetail?orderNo=${orderNumber}`,
      `https://c2c.binance.com/es/chatroom?orderNo=${orderNumber}`,
      `https://c2c.binance.com/es/chatroom?orderId=${orderNumber}`,
    ]) {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await p.waitForTimeout(3000);

      if (p.url().includes('/login')) return { ok: false, error: 'Sesión expirada' };

      const body = await p.evaluate(() => document.body?.innerText?.slice(0, 1000)).catch(() => '');
      if (!/cannot be found|sorry|page not found|no encontrada/i.test(body || '')) break;
    }

    const pageUrl = p.url();
    const body = await p.evaluate(() => document.body?.innerText?.slice(0, 2000)).catch(() => '');

    if (/cannot be found|sorry|page not found|no encontrada/i.test(body || '')) {
      return { ok: false, error: 'Orden_no_encontrada' };
    }

    const loginBtn = await p.locator('a, button').filter({ hasText: /Iniciar sesión|Sign In|Log In|Login/i }).first().isVisible().catch(() => false);
    if (loginBtn) return { ok: false, error: 'Sesión expirada' };

    const orderInBody = await p.evaluate((no) => {
      return document.body?.innerText?.includes(no.slice(-12)) || false;
    }, orderNumber).catch(() => false);

    if (!orderInBody) {
      const checkLogin = await p.locator('a, button').filter({ hasText: /Iniciar sesión|Sign In|Log In|Login/i }).first().isVisible().catch(() => false);
      if (checkLogin) return { ok: false, error: 'Sesión expirada' };
      return { ok: false, error: 'Orden_no_encontrada' };
    }

    if (/completado|cancelado|apelado|expir|vencido|time.?out|pagado|paid|cancelled/i.test(body || '')) {
      return { ok: false, error: 'Orden finalizada' };
    }

    // Find the chat textarea (known to exist on the order detail page)
    const textarea = await p.waitForSelector('textarea', { timeout: 5000 }).catch(() => null);
    if (!textarea) return { ok: false, error: 'No se encontró campo de texto (textarea)' };

    console.log(`[Playwright] Found textarea`);

    await textarea.click();
    await p.waitForTimeout(300);
    await textarea.fill(message);
    await p.waitForTimeout(300);

    // Try send button first, then Enter
    const sendBtn = p.locator('button[class*="send"], button[class*="envia"], button[class*="enviar"], button[class*="Send"], button:has(svg)').first();
    const btnVisible = await sendBtn.isVisible().catch(() => false);
    if (btnVisible) {
      await sendBtn.click();
    } else {
      await textarea.press('Enter');
    }
    await p.waitForTimeout(2000);

    const inputCleared = await textarea.evaluate((el: any) => el.value === '').catch(() => false);
    if (!inputCleared) {
      await textarea.press('Enter');
      await p.waitForTimeout(1000);
    }

    // Refresh cookies after each send
    if (globalTenantId) {
      saveCookiesToDb(globalTenantId, ctx).catch(() => {});
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  } finally {
    if (p) await p.close().catch(() => {});
  }
}

export async function initBrowser(tenantId?: number): Promise<boolean> {
  try {
    await getBrowser(tenantId);
    return true;
  } catch {
    return false;
  }
}

export async function sendChatMessage(
  orderNumber: string,
  message: string,
  cookies?: string,
  createdAt?: number,
  tenantId?: number
): Promise<{ ok: boolean; error?: string }> {
  if (tenantId && !globalTenantId) globalTenantId = tenantId;
  return doSend(orderNumber, message, createdAt);
}

export async function fetchChatMessages(
  orderNumber: string,
  createdAt?: number,
  tenantId?: number
): Promise<{ ok: boolean; messages: ChatMessage[]; error?: string }> {
  let p: Page | null = null;
  try {
    const tId = tenantId || globalTenantId;
    const { ctx } = await getBrowser(tId || undefined);
    p = await ctx.newPage();

    const ts = createdAt ?? Date.now();
    for (const url of [
      `https://c2c.binance.com/es/fiatOrderDetail?orderNo=${orderNumber}&createdAt=${ts}`,
      `https://c2c.binance.com/es/fiatOrderDetail?orderNo=${orderNumber}`,
      `https://c2c.binance.com/es/chatroom?orderNo=${orderNumber}`,
      `https://c2c.binance.com/es/chatroom?orderId=${orderNumber}`,
    ]) {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(2000);
      if (p.url().includes('/login')) return { ok: false, messages: [], error: 'Sesión expirada' };
      const body = await p.evaluate(() => document.body?.innerText?.slice(0, 1000)).catch(() => '');
      if (!/cannot be found|sorry|page not found|no encontrada/i.test(body || '')) break;
    }

    const body = await p.evaluate(() => document.body?.innerText?.slice(0, 2000)).catch(() => '');
    if (/cannot be found|sorry|page not found|no encontrada/i.test(body || '')) {
      return { ok: false, messages: [], error: 'Orden_no_encontrada' };
    }

    const loginBtn = await p.locator('a, button').filter({ hasText: /Iniciar sesión|Sign In|Log In|Login/i }).first().isVisible().catch(() => false);
    if (loginBtn) return { ok: false, messages: [], error: 'Sesión expirada' };

    // Extract chat messages from the page
    const messages: ChatMessage[] = await p.evaluate(() => {
      const result: ChatMessage[] = [];
      // Try common chat message selectors used by Binance
      const chatItems = document.querySelectorAll('[class*="message"], [class*="chat-item"], [class*="ChatMessage"], [class*="msg-item"], [class*="chat-msg"]');
      if (chatItems.length > 0) {
        chatItems.forEach((el, idx) => {
          const text = (el as HTMLElement).innerText?.trim();
          if (text) {
            const isSelf = !!el.querySelector('[class*="self"], [class*="own"], [class*="mine"], [class*="right"]');
            result.push({
              id: `pw-${idx}`,
              type: 'user',
              content: text,
              self: isSelf,
              createTime: Date.now() + idx,
              imageUrl: null,
            });
          }
        });
      } else {
        // Fallback: try to find messages in the page text
        const chatSection = document.querySelector('[class*="chat"], [class*="Chat"], [class*="message-list"], [class*="msg-list"]');
        if (chatSection) {
          const items = chatSection.querySelectorAll('div > div > div');
          items.forEach((el, idx) => {
            const text = (el as HTMLElement).innerText?.trim();
            if (text && text.length > 2 && text.length < 500) {
              result.push({
                id: `pw-${idx}`,
                type: 'user',
                content: text,
                self: false,
                createTime: Date.now() + idx,
                imageUrl: null,
              });
            }
          });
        }
      }
      return result;
    });

    return { ok: true, messages };
  } catch (err: any) {
    return { ok: false, messages: [], error: err.message };
  } finally {
    if (p) await p.close().catch(() => {});
  }
}

export async function ensureLoggedIn(): Promise<boolean> {
  try {
    const { browser, ctx } = await getBrowser();
    const p = await ctx.newPage();
    await p.goto('https://c2c.binance.com/es', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(3000);
    const ok = !p.url().includes('/login');
    await p.close().catch(() => {});
    return ok;
  } catch {
    return false;
  }
}

export async function setupLogin(tenantId?: number): Promise<boolean> {
  let browser: Browser | null = null;
  let ctx: BrowserContext | null = null;

  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--window-size=1366,900'],
    });

    ctx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: UA,
      locale: 'es-CL',
      deviceScaleFactor: 2,
      timezoneId: 'America/Santiago',
    });

    const p = await ctx.newPage();
    await p.goto('https://c2c.binance.com/es', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2000);

    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  INICIA SESIÓN EN BINANCE EN LA VENTANA ABIERTA     ║');
    console.log('║  Después de loguearte, escribe "ok" + ENTER aquí    ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    await new Promise<void>((resolve) => {
      process.stdin.once('data', (data) => {
        if (data.toString().trim().toLowerCase() === 'ok') resolve();
      });
    });

    await p.waitForTimeout(3000);
    await ctx.storageState({ path: STATE_FILE });
    if (tenantId) await saveCookiesToDb(tenantId, ctx);
    return true;
  } catch (err) {
    console.error('[Setup] Error:', err);
    return false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function closeAllBrowsers(): Promise<void> {
  if (globalBrowser) {
    try { await globalBrowser.close(); } catch {}
    globalBrowser = null;
    globalCtx = null;
  }
}
