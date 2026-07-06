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
    const { storeCookies } = await import('./chat-browser');
    await storeCookies(tenantId, state);
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

  // Create context with storage state if available
  if (tenantId) {
    const { getStorageState, getStoredCookies } = await import('./chat-browser');
    const storageState = await getStorageState(tenantId);
    if (storageState) {
      globalCtx = await globalBrowser.newContext({
        viewport: { width: 1366, height: 900 },
        userAgent: UA,
        locale: 'es-CL',
        deviceScaleFactor: 2,
        timezoneId: 'America/Santiago',
        geolocation: { latitude: -33.4489, longitude: -70.6693 },
        permissions: [],
        storageState: storageState as any,
      });
    } else {
      globalCtx = await globalBrowser.newContext({
        viewport: { width: 1366, height: 900 },
        userAgent: UA,
        locale: 'es-CL',
        deviceScaleFactor: 2,
        timezoneId: 'America/Santiago',
        geolocation: { latitude: -33.4489, longitude: -70.6693 },
        permissions: [],
      });
      const cookies = await getStoredCookies(tenantId);
      if (cookies) {
        const parsed = parseCookies(cookies);
        if (parsed.length > 0) {
          await globalCtx.addCookies(parsed);
        }
      }
    }
    globalTenantId = tenantId;

    // Refresh cookies in background
    saveCookiesToDb(globalTenantId, globalCtx).catch(() => {});
  } else {
    globalCtx = await globalBrowser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: UA,
      locale: 'es-CL',
      deviceScaleFactor: 2,
      timezoneId: 'America/Santiago',
      geolocation: { latitude: -33.4489, longitude: -70.6693 },
      permissions: [],
    });
  }

  // Setup globalCtx if not set already (needed for fallback path)
  if (!globalCtx) {
    globalCtx = await globalBrowser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: UA,
      locale: 'es-CL',
      deviceScaleFactor: 2,
      timezoneId: 'America/Santiago',
      geolocation: { latitude: -33.4489, longitude: -70.6693 },
      permissions: [],
    });
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

      // Skip if redirected to login, try next URL
      if (p.url().includes('/login')) continue;

      const body = await p.evaluate(() => document.body?.innerText?.slice(0, 1000)).catch(() => '');
      if (!/cannot be found|sorry|page not found|no encontrada/i.test(body || '')) break;
    }

    const pageUrl = p.url();
    let body = await p.evaluate(() => document.body?.innerText?.slice(0, 2000)).catch(() => '');

    if (p.url().includes('/login')) {
      return { ok: false, error: 'Sesión expirada' };
    }

    if (/cannot be found|sorry|page not found|no encontrada|no existe/i.test(body || '')) {
      return { ok: false, error: 'Orden_no_encontrada' };
    }

    const loginBtn = await p.locator('a, button').filter({ hasText: /Iniciar sesión|Sign In|Log In|Login/i }).first().isVisible().catch(() => false);
    if (loginBtn) {
      // Check if this is the BINANCE login button (on homepage) vs a "chat login" button
      return { ok: false, error: 'Sesión expirada' };
    }

    const orderInBody = await p.evaluate((no) => {
      return document.body?.innerText?.includes(no.slice(-12)) || false;
    }, orderNumber).catch(() => false);

    const isFinalized = /^(Orden |La orden ha sido |Order )?(completad[oa]|cancelad[oa]|apelad[oa])|(expirad[oa]|vencid[oa]|time.?out)/im.test(body || '');

    // Dismiss Binance identity popup if present
    await p.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (/siguiente|aceptar|next|ok|got it/i.test(btn.textContent || '')) {
          (btn as HTMLElement).click();
        }
      }
    }).catch(() => {});
    await p.waitForTimeout(1000);

    // Find the chat textarea (only on order-specific pages, not on general P2P landing)
    let textarea = await p.waitForSelector('textarea', { timeout: 2000 }).catch(() => null);
    
    // If no textarea and order IS found (active), try clicking the Chat tab on order detail
    if (!textarea && orderInBody) {
      const chatTab = p.locator('a, button, div[role="tab"], div[class*="chat"]').filter({ hasText: /Chat/i }).first();
      const chatTabVisible = await chatTab.isVisible().catch(() => false);
      if (chatTabVisible) {
        await chatTab.click();
        await p.waitForTimeout(3000);
        textarea = await p.waitForSelector('textarea', { timeout: 5000 }).catch(() => null);
      }
    }

    // If still no textarea, go directly to chatroom page
    if (!textarea) {
      for (const chatUrl of [
        `https://c2c.binance.com/es/chatroom?orderNo=${orderNumber}`,
        `https://c2c.binance.com/es/chatroom?orderId=${orderNumber}`,
      ]) {
        await p.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        // Wait for skeleton to disappear and page to render
        try {
          await p.waitForFunction(() => !document.querySelector('[data-cy="chat-loading-skeleton"]'), { timeout: 15000 });
        } catch {}
        await p.waitForTimeout(2000);
        if (p.url().includes('/login')) continue;

        // Dismiss identity popup (may have multiple steps)
        for (let i = 0; i < 5; i++) {
          const dismissed = await p.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const btn of btns) {
              if (/siguiente|aceptar|next|ok|got it/i.test(btn.textContent || '')) {
                (btn as HTMLElement).click();
                return true;
              }
            }
            return false;
          }).catch(() => false);
          if (!dismissed) break;
          await p.waitForTimeout(1000);
        }

        // Try to click conversation matching the order number suffix
        const convClicked = await p.evaluate((no) => {
          const allElements = document.querySelectorAll('div');
          for (const el of allElements) {
            const text = el.textContent || '';
            const noSuffix = no.slice(-12);
            if (text.includes(noSuffix) && el.offsetWidth > 50 && el.offsetHeight > 20) {
              (el as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, orderNumber).catch(() => false);
        
        if (convClicked) {
          await p.waitForTimeout(3000);
        } else {
          // Click the first conversation listed under "Chats"
          const firstConv = await p.evaluate(() => {
            const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, div');
            let afterChats = false;
            for (const h of headings) {
              if ((h.textContent || '').trim() === 'Chats') {
                afterChats = true;
                continue;
              }
              const rect = h.getBoundingClientRect();
              if (afterChats && rect.width > 50 && rect.height > 20) {
                const text = (h.textContent || '').trim();
                if (text.length > 3 && text.length < 100 && h.children.length < 5) {
                  (h as HTMLElement).click();
                  return true;
                }
              }
            }
            // Fallback: try any clickable item
            const items = document.querySelectorAll('div[role="button"], li, [class*="chat-item"]');
            for (const el of items) {
              const text = (el.textContent || '').trim();
              const r = el.getBoundingClientRect();
              if (text.length > 5 && text.length < 200 && r.width > 50 && r.height > 20) {
                (el as HTMLElement).click();
                return true;
              }
            }
            return false;
          }).catch(() => false);
          if (firstConv) await p.waitForTimeout(5000);
        }
        
        textarea = await p.waitForSelector('textarea', { timeout: 10000 }).catch(() => null);
        if (textarea) break;
      }
    }
    
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

    const orderInBody = await p.evaluate((no) => {
      return document.body?.innerText?.includes(no.slice(-12)) || false;
    }, orderNumber).catch(() => false);

    // Dismiss identity popup if present
    await p.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (/siguiente|aceptar|next|ok|got it/i.test(btn.textContent || '')) {
          (btn as HTMLElement).click();
        }
      }
    }).catch(() => {});
    await p.waitForTimeout(1000);

    // Try clicking the Chat tab on order detail page
    const chatTab = p.locator('a, button, div[role="tab"], div[class*="chat"]').filter({ hasText: /Chat/i }).first();
    const chatTabVisible = await chatTab.isVisible().catch(() => false);
    if (chatTabVisible) {
      await chatTab.click();
      await p.waitForTimeout(3000);
    }

    // If not on chatroom page and no chat tab found, go to chatroom directly
    let onChatroom = p.url().includes('/chatroom');
    if (!onChatroom && !chatTabVisible) {
      for (const chatUrl of [
        `https://c2c.binance.com/es/chatroom?orderNo=${orderNumber}`,
        `https://c2c.binance.com/es/chatroom?orderId=${orderNumber}`,
      ]) {
        await p.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await p.waitForTimeout(2000);
        if (p.url().includes('/login')) continue;

        // Dismiss identity popup (may have multiple steps)
        for (let i = 0; i < 5; i++) {
          const dismissed = await p.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const btn of btns) {
              if (/siguiente|aceptar|next|ok|got it/i.test(btn.textContent || '')) {
                (btn as HTMLElement).click();
                return true;
              }
            }
            return false;
          }).catch(() => false);
          if (!dismissed) break;
          await p.waitForTimeout(1000);
        }

        // Try to click conversation matching the order number suffix
        const convClicked = await p.evaluate((no) => {
          const allElements = document.querySelectorAll('div');
          for (const el of allElements) {
            const text = el.textContent || '';
            const noSuffix = no.slice(-12);
            if (text.includes(noSuffix) && el.offsetWidth > 50 && el.offsetHeight > 20) {
              (el as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, orderNumber).catch(() => false);

        if (convClicked) {
          await p.waitForTimeout(3000);
        } else {
          // Click the first conversation listed
          const firstConv = await p.evaluate(() => {
            const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, div');
            let afterChats = false;
            for (const h of headings) {
              if ((h.textContent || '').trim() === 'Chats') {
                afterChats = true;
                continue;
              }
              const rect = h.getBoundingClientRect();
              if (afterChats && rect.width > 50 && rect.height > 20) {
                const text = (h.textContent || '').trim();
                if (text.length > 3 && text.length < 100 && h.children.length < 5) {
                  (h as HTMLElement).click();
                  return true;
                }
              }
            }
            const items = document.querySelectorAll('div[role="button"], li, [class*="chat-item"]');
            for (const el of items) {
              const text = (el.textContent || '').trim();
              const r = el.getBoundingClientRect();
              if (text.length > 5 && text.length < 200 && r.width > 50 && r.height > 20) {
                (el as HTMLElement).click();
                return true;
              }
            }
            return false;
          }).catch(() => false);
          if (firstConv) await p.waitForTimeout(5000);
        }
        onChatroom = true;
        break;
      }
    }

    // Extract chat messages from the page
    const messages: ChatMessage[] = await p.evaluate(() => {
      const result: ChatMessage[] = [];
      const chatItems = document.querySelectorAll('[class*="message"], [class*="chat-item"], [class*="ChatMessage"], [class*="msg-item"], [class*="chat-msg"]');
      if (chatItems.length > 0) {
        const total = chatItems.length;
        chatItems.forEach((el, idx) => {
          const text = (el as HTMLElement).innerText?.trim();
          if (text) {
            const isSelf = !!el.querySelector('[class*="self"], [class*="own"], [class*="mine"], [class*="right"]');
            result.push({
              id: `pw-${idx}`,
              type: 'user',
              content: text,
              self: isSelf,
              createTime: Date.now() - (total - 1 - idx) * 60000,
              imageUrl: null,
            });
          }
        });
      } else {
        const chatSection = document.querySelector('[class*="chat"], [class*="Chat"], [class*="message-list"], [class*="msg-list"]');
        if (chatSection) {
          const items = chatSection.querySelectorAll('div > div > div');
          const total = items.length;
          items.forEach((el, idx) => {
            const text = (el as HTMLElement).innerText?.trim();
            if (text && text.length > 2 && text.length < 500) {
              result.push({
                id: `pw-${idx}`,
                type: 'user',
                content: text,
                self: false,
                createTime: Date.now() - (total - 1 - idx) * 60000,
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

export async function fetchBuyerName(
  orderNumber: string,
  tenantId?: number
): Promise<{ ok: boolean; name?: string; error?: string }> {
  let p: Page | null = null;
  try {
    const tId = tenantId || globalTenantId;
    const { ctx } = await getBrowser(tId || undefined);
    p = await ctx.newPage();

    await p.goto(`https://c2c.binance.com/es/fiatOrderDetail?orderNo=${orderNumber}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(4000);

    if (p.url().includes('/login')) return { ok: false, error: 'Sesión expirada' };

    // Extract all visible text and find buyer name
    const name = await p.evaluate(() => {
      const bodyText = document.body?.innerText || '';

      // If page shows masked nickname, there's no real name yet
      if (bodyText.includes('***')) return '';

      // Find name near "Comprador" or "Buyer" label
      const allEls = document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6, label');
      for (const el of allEls) {
        const text = (el.textContent || '').trim();
        const lower = text.toLowerCase();
        if (lower.includes('comprador') || lower.includes('buyer') || lower.includes('compras')) {
          // Look at next sibling or parent's next sibling for the actual name
          let sibling = el.nextElementSibling;
          if (sibling) {
            const sibText = (sibling.textContent || '').trim();
            if (sibText.length > 3 && sibText.length < 100 && !sibText.includes('***') && !sibText.includes('P2P')) {
              return sibText;
            }
          }
          // Try parent's children
          const parent = el.parentElement;
          if (parent) {
            const children = parent.querySelectorAll('div, span, p');
            for (const child of children) {
              const ct = (child.textContent || '').trim();
              if (ct.length > 3 && ct.length < 100 && !ct.includes('***') && !ct.includes('P2P') && ct !== text) {
                return ct;
              }
            }
          }
        }
      }

      // Fallback: find any name-like text on the page (not masked, 2+ words)
      const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 5 && l.length < 100);
      for (const line of lines) {
        if (!line.includes('***') && !line.includes('P2P') && !line.includes('@') && !line.includes('.com') &&
            line.includes(' ') && /[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]/.test(line) && /[A-ZÁÉÍÓÚÜÑ]/.test(line.slice(1))) {
          return line;
        }
      }

      return '';
    }).catch(() => '');

    if (name) return { ok: true, name };
    return { ok: false, error: 'Nombre no encontrado en la página' };
  } catch (err: any) {
    return { ok: false, error: err.message };
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
    const state = await ctx.storageState();
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
