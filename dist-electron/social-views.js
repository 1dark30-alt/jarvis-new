"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocialViewsService = void 0;
const electron_1 = require("electron");
const HOME_URL = {
    instagram: 'https://www.instagram.com/',
    tiktok: 'https://www.tiktok.com/',
    facebook: 'https://www.facebook.com/',
    youtube: 'https://www.youtube.com/',
};
const PLATFORMS = ['instagram', 'tiktok', 'facebook', 'youtube'];
/**
 * Embeds four Chromium panes (Instagram / TikTok / Facebook / YouTube) as
 * WebContentsViews on top of the main window. Bounds are driven by the
 * renderer so they line up with the Social Command placeholders.
 */
class SocialViewsService {
    constructor(getMainWindow) {
        this.getMainWindow = getMainWindow;
        this.views = new Map();
        this.active = false;
        /** Serialize posts so two typers can't interleave into the same Draft.js box. */
        this.postChain = Promise.resolve();
    }
    get isActive() {
        return this.active;
    }
    start() {
        const win = this.getMainWindow();
        if (!win || win.isDestroyed())
            return { success: false, error: 'No main window' };
        this.stop();
        try {
            for (const id of PLATFORMS) {
                const partition = `persist:jarvis-social-${id}`;
                // Touch the session so the persistent partition is created
                electron_1.session.fromPartition(partition);
                const view = new electron_1.WebContentsView({
                    webPreferences: {
                        partition,
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: true,
                    },
                });
                view.setBackgroundColor('#000000');
                view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
                win.contentView.addChildView(view);
                void view.webContents.loadURL(HOME_URL[id]);
                this.views.set(id, view);
            }
            this.active = true;
            return { success: true };
        }
        catch (err) {
            this.stop();
            return { success: false, error: err instanceof Error ? err.message : 'Failed to start social views' };
        }
    }
    stop() {
        const win = this.getMainWindow();
        for (const [, view] of this.views) {
            try {
                if (win && !win.isDestroyed()) {
                    win.contentView.removeChildView(view);
                }
            }
            catch { /* already removed */ }
            try {
                if (!view.webContents.isDestroyed()) {
                    view.webContents.close();
                }
            }
            catch { /* ignore */ }
        }
        this.views.clear();
        this.active = false;
        return { success: true };
    }
    setBounds(id, bounds) {
        const view = this.views.get(id);
        if (!view)
            return { success: false };
        const w = Math.max(0, Math.round(bounds.width));
        const h = Math.max(0, Math.round(bounds.height));
        const x = Math.max(0, Math.round(bounds.x));
        const y = Math.max(0, Math.round(bounds.y));
        view.setBounds({ x, y, width: w, height: h });
        // Keep social panes above the main UI
        const win = this.getMainWindow();
        if (win && !win.isDestroyed()) {
            win.contentView.addChildView(view);
        }
        return { success: true };
    }
    setAllBounds(all) {
        for (const id of PLATFORMS) {
            const b = all[id];
            if (b)
                this.setBounds(id, b);
        }
        return { success: true };
    }
    navigate(id, url) {
        const view = this.views.get(id);
        if (!view)
            return { success: false, error: 'View not found' };
        let next = url.trim();
        if (!next)
            return { success: false, error: 'Empty URL' };
        if (!/^https?:\/\//i.test(next))
            next = `https://${next}`;
        void view.webContents.loadURL(next);
        return { success: true };
    }
    navigateAll(url) {
        for (const id of PLATFORMS)
            this.navigate(id, url);
        return { success: true };
    }
    reload(id) {
        const view = this.views.get(id);
        if (!view)
            return { success: false };
        view.webContents.reload();
        return { success: true };
    }
    goHome(id) {
        return this.navigate(id, HOME_URL[id]);
    }
    getUrl(id) {
        const view = this.views.get(id);
        if (!view)
            return { success: false };
        return { success: true, url: view.webContents.getURL() };
    }
    getTitle(id) {
        const view = this.views.get(id);
        if (!view)
            return { success: false };
        return { success: true, title: view.webContents.getTitle() };
    }
    async captureHtml(id) {
        const view = this.views.get(id);
        if (!view)
            return { success: false, error: 'View not found' };
        try {
            const html = await view.webContents.executeJavaScript(`(() => {
          const clone = document.documentElement.cloneNode(true);
          return '<!DOCTYPE html>\\n' + clone.outerHTML;
        })()`, true);
            return {
                success: true,
                html,
                url: view.webContents.getURL(),
                title: view.webContents.getTitle(),
            };
        }
        catch (err) {
            return { success: false, error: err instanceof Error ? err.message : 'Capture failed' };
        }
    }
    async executeJavaScript(id, code) {
        const view = this.views.get(id);
        if (!view)
            return { success: false, error: 'View not found' };
        try {
            const result = await view.webContents.executeJavaScript(code, true);
            return { success: true, result };
        }
        catch (err) {
            return { success: false, error: err instanceof Error ? err.message : 'exec failed' };
        }
    }
    sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }
    /**
     * Post a reply using native Chromium text insertion.
     * Draft.js (TikTok) ignores most synthetic DOM input events; insertText works.
     * Never type character-by-character — Draft.js caret races produce gibberish.
     */
    async postReply(id, author, commentText, reply, options) {
        const run = this.postReplyUnlocked(id, author, commentText, reply, options);
        const queued = this.postChain.then(() => run, () => run);
        this.postChain = queued.then(() => undefined, () => undefined);
        return queued;
    }
    async postReplyUnlocked(id, author, commentText, reply, options) {
        const view = this.views.get(id);
        if (!view || view.webContents.isDestroyed()) {
            return { success: false, error: 'View not found' };
        }
        if (!reply.trim())
            return { success: false, error: 'Empty reply' };
        const typingMs = Math.max(0, Math.round(options?.typingMsPerChar ?? 0));
        const jitterMs = Math.max(0, Math.round(options?.typingJitterMs ?? 0));
        const wc = view.webContents;
        const authorJson = JSON.stringify(author);
        const commentJson = JSON.stringify(commentText);
        const clearComposer = async () => {
            const mod = process.platform === 'darwin' ? 'meta' : 'control';
            wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [mod] });
            wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: [mod] });
            await this.sleep(40);
            wc.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
            wc.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
            await this.sleep(60);
        };
        const readComposer = async () => (await wc.executeJavaScript(`(() => {
        const editor = document.querySelector('.public-DraftEditor-content[contenteditable="true"]')
          || document.querySelector('textarea[aria-label*="Add a comment"], textarea[placeholder*="Add a comment"]')
          || document.querySelector('[contenteditable="true"][role="textbox"]');
        if (!editor) return '';
        return (editor.innerText || editor.value || '').replace(/\\u00a0/g, ' ').trim();
      })()`, true));
        try {
            // 1) Find comment, click Reply, focus the composer
            const prep = await wc.executeJavaScript(`(async () => {
        const author = ${authorJson};
        const commentText = ${commentJson};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();

        if (${JSON.stringify(id)} === 'tiktok') {
          const creator = ((location.pathname.match(/\\/@([^/]+)/) || [])[1] || '').toLowerCase();
          const items = Array.from(document.querySelectorAll('[class*="DivCommentItemContainer"]'));
          let target = null;
          for (const item of items) {
            const href = item.querySelector('a[href^="/@"]')?.getAttribute('href') || '';
            const handle = href.replace(/^\\/@/, '').split(/[/?#]/)[0];
            if (handle.toLowerCase() !== author.toLowerCase()) continue;
            const text = (item.querySelector('[data-e2e="comment-level-1"]')?.innerText || '').trim();
            if (norm(text).includes(norm(commentText).slice(0, 40)) || norm(commentText).includes(norm(text).slice(0, 40))) {
              target = item;
              break;
            }
          }
          if (!target) return { ok: false, error: 'Comment not found in DOM' };

          // Expand replies under this comment and abort if we already answered
          const viewMore = Array.from(target.querySelectorAll('[data-e2e="view-more-1"], p[role="button"][aria-label], div[role="button"][aria-label]'))
            .filter((el) => /view\\s+\\d*\\s*repl/i.test(el.getAttribute('aria-label') || el.textContent || ''));
          for (const btn of viewMore) {
            try { btn.click(); } catch { /* ignore */ }
          }
          if (viewMore.length) await sleep(700);

          const alreadyReplied =
            !!target.querySelector('[data-e2e="comment-creator-2"]')
            || (!!creator && Array.from(target.querySelectorAll('a[href^="/@"]')).some((a, idx) => {
              if (idx === 0) return false; // skip parent commenter
              const h = (a.getAttribute('href') || '').replace(/^\\/@/, '').split(/[/?#]/)[0].toLowerCase();
              return h === creator;
            }))
            || (!!target.querySelector('[data-e2e="comment-level-2"]') && /\\bCreator\\b/.test(target.textContent || ''));

          if (alreadyReplied) {
            return { ok: false, error: 'Already replied to this comment — skipped' };
          }

          target.querySelector('[data-e2e="comment-reply-1"]')?.click();
          await sleep(450);
          document.querySelector('[data-e2e="comment-input"]')?.click();
          await sleep(100);
          const editor = document.querySelector('[data-e2e="comment-input"] .public-DraftEditor-content[contenteditable="true"]')
            || document.querySelector('.public-DraftEditor-content[contenteditable="true"]')
            || document.querySelector('[contenteditable="true"][role="textbox"]');
          if (!editor) return { ok: false, error: 'Comment editor not found — open comments first' };
          editor.focus();
          editor.click();
          return { ok: true, platform: 'tiktok' };
        }

        if (${JSON.stringify(id)} === 'instagram') {
          const items = Array.from(document.querySelectorAll('li._a9zj'));
          let target = null;
          for (const li of items) {
            const links = Array.from(li.querySelectorAll('a[href^="/"]'))
              .map((a) => (a.getAttribute('href') || '').split('/').filter(Boolean)[0]);
            if ((links[0] || '').toLowerCase() !== author.toLowerCase()) continue;
            if (norm(li.innerText).includes(norm(commentText).slice(0, 40))) {
              target = li;
              break;
            }
          }
          if (!target) return { ok: false, error: 'Comment not found in DOM' };
          const replyBtn = Array.from(target.querySelectorAll('button, [role="button"]'))
            .find((el) => /^reply$/i.test((el.textContent || '').trim()));
          replyBtn?.click();
          await sleep(350);
          const textarea = document.querySelector('textarea[aria-label*="Add a comment"], textarea[placeholder*="Add a comment"]');
          if (!textarea) return { ok: false, error: 'Comment box not found — open the comments panel' };
          textarea.focus();
          textarea.click();
          return { ok: true, platform: 'instagram' };
        }

        return { ok: false, error: 'Posting not supported for this platform yet' };
      })()`, true);
            if (!prep?.ok) {
                return { success: false, error: prep?.error || 'Could not prepare comment composer' };
            }
            // 2) Focus the guest webContents so Chromium routes keystrokes there
            wc.focus();
            await this.sleep(80);
            await clearComposer();
            // 3) Optional human "think" pause, then paste the FULL reply once.
            // Per-character insertText races Draft.js and produces interleaved nonsense.
            if (typingMs > 0) {
                const think = reply.length * typingMs;
                const jitter = jitterMs > 0 ? Math.floor(Math.random() * (jitterMs * reply.length * 0.5)) : 0;
                await this.sleep(Math.min(8000, Math.max(200, think + jitter)));
            }
            wc.insertText(reply);
            await this.sleep(280);
            let typed = await readComposer();
            const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
            const looksGood = typed && (norm(typed) === norm(reply) || norm(typed).endsWith(norm(reply)));
            if (!looksGood) {
                // Clear @mention leftovers / partial garbage and paste once more
                await clearComposer();
                wc.insertText(reply);
                await this.sleep(280);
                typed = await readComposer();
            }
            if (!typed || !(norm(typed) === norm(reply) || norm(typed).includes(norm(reply)))) {
                return {
                    success: false,
                    error: `Composer text looked wrong before send ("${(typed || '').slice(0, 60)}"). Skipped to avoid nonsense.`,
                };
            }
            // Drop a leading @mention TikTok may keep if the reply itself doesn't start with @
            if (typed.startsWith('@') && !reply.trim().startsWith('@') && norm(typed).includes(norm(reply))) {
                // still OK — Post with mention+reply is fine
            }
            // 4) Wait for Post to enable, then click
            const posted = await wc.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const disabled = (btn) => !btn || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true' || btn.disabled === true;

        if (${JSON.stringify(id)} === 'tiktok') {
          const postBtn = document.querySelector('[data-e2e="comment-post"]');
          if (!postBtn) return { ok: false, error: 'Post button not found' };
          for (let i = 0; i < 20; i++) {
            if (!disabled(postBtn)) break;
            await sleep(100);
          }
          if (disabled(postBtn)) {
            return { ok: false, error: 'TikTok Post stayed disabled after native typing. Make sure comments are open and try Send again.' };
          }
          postBtn.click();
          await sleep(700);
          return { ok: true };
        }

        if (${JSON.stringify(id)} === 'instagram') {
          const postBtn = Array.from(document.querySelectorAll('div[role="button"], button'))
            .find((el) => /^post$/i.test((el.textContent || '').trim()) && el.getAttribute('aria-disabled') !== 'true');
          if (!postBtn) return { ok: false, error: 'Post button not found or disabled' };
          postBtn.click();
          await sleep(600);
          return { ok: true };
        }

        return { ok: false, error: 'Unsupported platform' };
      })()`, true);
            if (!posted?.ok) {
                return { success: false, error: posted?.error || 'Failed to click Post' };
            }
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err instanceof Error ? err.message : 'postReply failed' };
        }
    }
}
exports.SocialViewsService = SocialViewsService;
