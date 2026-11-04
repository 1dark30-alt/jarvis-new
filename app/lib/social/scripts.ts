/**
 * JavaScript payloads executed inside each social WebContentsView via socialExec.
 * Keep these self-contained — no imports, no TypeScript.
 */

export type SocialPlatformId = 'instagram' | 'tiktok' | 'facebook' | 'youtube';

export interface ScrapedComment {
  author: string;
  text: string;
  key: string;
  ageSeconds: number;
  alreadyReplied: boolean;
  isOwn: boolean;
}

export interface ScrapeResult {
  platform: SocialPlatformId;
  creator: string | null;
  comments: ScrapedComment[];
  error?: string;
  debug?: {
    rawFound: number;
    skippedOwn: number;
    skippedReplied: number;
    strategy?: string;
  };
}

const PARSE_AGE_HELPER = `
  function __jarvisParseAge(raw) {
    if (!raw) return Number.MAX_SAFE_INTEGER;
    const iso = Date.parse(raw);
    if (!Number.isNaN(iso)) return Math.max(0, (Date.now() - iso) / 1000);
    const m = String(raw).trim().match(/(\\d+)\\s*([smhdwy])/i);
    if (!m) return Number.MAX_SAFE_INTEGER;
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const mult = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 }[unit] || 1;
    return n * mult;
  }
  function __jarvisNormText(text) {
    return String(text || '')
      .replace(/["'\u201c\u201d]/g, '')
      .replace(/\\s+/g, ' ')
      .trim()
      .toLowerCase()
      .slice(0, 180);
  }
  function __jarvisKey(author, text) {
    return String(author || '').toLowerCase().trim() + '::' + __jarvisNormText(text);
  }
  function __jarvisSleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
`;

/** Scrape visible unreplied-looking comments from the active Instagram post/reel. */
export const INSTAGRAM_SCRAPE = `(() => {
  ${PARSE_AGE_HELPER}
  try {
    const headerLink = document.querySelector('article header a[href^="/"]')
      || document.querySelector('a[href^="/"][role="link"]');
    const creator = (headerLink?.getAttribute('href') || '').split('/').filter(Boolean)[0] || null;

    let items = Array.from(document.querySelectorAll('li._a9zj'));
    let strategy = 'li._a9zj';
    if (!items.length) {
      // Fallback: any Reply button's comment block
      const replyBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((el) => /^reply$/i.test((el.textContent || '').trim()));
      items = replyBtns.map((btn) => {
        let n = btn.parentElement;
        for (let i = 0; i < 10 && n; i++) {
          if (n.querySelector && n.querySelector('a[href^="/"]') && n.querySelector('[dir="auto"]')) return n;
          n = n.parentElement;
        }
        return btn.closest('li') || btn.parentElement;
      }).filter(Boolean);
      strategy = 'reply-button-walk';
    }

    const comments = [];
    let skippedOwn = 0;
    let skippedReplied = 0;
    const seenLocal = new Set();

    for (const li of items) {
      if (!li) continue;
      const links = Array.from(li.querySelectorAll('a[href^="/"]'))
        .map((a) => (a.getAttribute('href') || '').split('/').filter(Boolean)[0])
        .filter((u) => u && !['p','reel','reels','explore','accounts','direct','stories'].includes(u));
      const author = links[0] || '';
      if (!author) continue;

      const timeEl = li.querySelector('time[datetime]');
      const ageSeconds = __jarvisParseAge(timeEl?.getAttribute('datetime') || timeEl?.textContent || '');

      let text = '';
      for (const span of li.querySelectorAll('[dir="auto"]')) {
        const t = (span.textContent || '').trim();
        if (!t || t === author) continue;
        if (/^(Verified|Reply|Like|Unlike|View replies|Edited)$/i.test(t)) continue;
        if (/^\\d+[smhdw]$/i.test(t) || /^\\d+\\s*likes?$/i.test(t)) continue;
        text = t;
        break;
      }
      if (!text) continue;

      const key = __jarvisKey(author, text);
      if (seenLocal.has(key)) continue;
      seenLocal.add(key);

      const isOwn = !!(creator && author.toLowerCase() === creator.toLowerCase());
      const others = links.slice(1).map((u) => u.toLowerCase());
      const alreadyReplied = !!(creator && others.includes(creator.toLowerCase()));
      if (isOwn) { skippedOwn += 1; continue; }
      if (alreadyReplied) { skippedReplied += 1; continue; }

      comments.push({
        author,
        text,
        key,
        ageSeconds,
        alreadyReplied: false,
        isOwn: false,
      });
    }

    comments.sort((a, b) => a.ageSeconds - b.ageSeconds);
    return {
      platform: 'instagram',
      creator,
      comments: comments.slice(0, 40),
      debug: { rawFound: seenLocal.size, skippedOwn, skippedReplied, strategy },
    };
  } catch (err) {
    return { platform: 'instagram', creator: null, comments: [], error: String(err?.message || err) };
  }
})()`;

/** Scrape visible TikTok comments; skip threads where the creator already replied. */
export const TIKTOK_SCRAPE = `(async () => {
  ${PARSE_AGE_HELPER}
  try {
    const pathHandle = (location.pathname.match(/\\/@([^/]+)/) || [])[1] || null;
    const og = document.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
    const ogHandle = (og.match(/\\/@([^/?#]+)/) || [])[1] || null;
    const creator = (pathHandle || ogHandle || '').toLowerCase() || null;

    // Expand collapsed reply threads so creator replies become visible
    const viewMore = Array.from(document.querySelectorAll('[data-e2e="view-more-1"], p[role="button"][aria-label], div[role="button"][aria-label]'))
      .filter((el) => /view\\s+\\d*\\s*repl/i.test(el.getAttribute('aria-label') || el.textContent || ''));
    for (const btn of viewMore.slice(0, 25)) {
      try { btn.click(); } catch { /* ignore */ }
    }
    if (viewMore.length) await __jarvisSleep(750);

    // Prefer full comment item roots (includes nested creator replies)
    let items = Array.from(document.querySelectorAll('[class*="DivCommentItemContainer"]'));
    let strategy = 'DivCommentItemContainer';
    if (!items.length) {
      const textEls = Array.from(document.querySelectorAll('[data-e2e="comment-level-1"]'));
      items = textEls.map((el) => el.closest('[class*="CommentItem"]') || el.parentElement).filter(Boolean);
      strategy = 'comment-level-1-closest';
    }

    const comments = [];
    let skippedOwn = 0;
    let skippedReplied = 0;
    const seenLocal = new Set();

    const hasCreatorReply = (root) => {
      if (!root) return false;
      if (root.querySelector('[data-e2e="comment-creator-2"]')) return true;
      if (root.querySelector('[data-e2e="comment-level-2"]') && /\\bCreator\\b/i.test(root.textContent || '')) {
        // Nested reply marked Creator
        if (creator) {
          const nestedLinks = Array.from(root.querySelectorAll('[data-e2e="comment-username-2"], a[href^="/@"]'))
            .map((a) => (a.getAttribute?.('href') || a.closest?.('a')?.getAttribute('href') || ''))
            .map((h) => h.replace(/^\\/@/, '').split(/[/?#]/)[0].toLowerCase())
            .filter(Boolean);
          // top-level author is first /@ link; any later match to creator counts
          if (nestedLinks.some((h, idx) => idx > 0 && h === creator)) return true;
          if (root.querySelector('[data-e2e="comment-username-2"]') && nestedLinks.includes(creator)) return true;
        } else {
          return true;
        }
      }
      if (creator) {
        for (const a of root.querySelectorAll('a[href^="/@"]')) {
          const handle = (a.getAttribute('href') || '').replace(/^\\/@/, '').split(/[/?#]/)[0].toLowerCase();
          if (handle !== creator) continue;
          // Creator link that sits in a nested reply (level-2), not the parent commenter
          if (a.closest('[data-e2e="comment-username-2"]') || a.querySelector('[data-e2e="comment-username-2"]')) return true;
          if (a.closest('[class*="Reply"]') || a.closest('[data-e2e="comment-level-2"]')?.parentElement) {
            const lvl2 = a.closest('[class*="CommentContent"], [class*="DivCommentContent"], li, div');
            if (lvl2 && lvl2.querySelector('[data-e2e="comment-level-2"], [data-e2e="comment-time-2"]')) return true;
          }
        }
      }
      return false;
    };

    for (const root of items) {
      const textEl = root.querySelector('[data-e2e="comment-level-1"]')
        || root.querySelector('[class*="PCommentText"]');
      if (!textEl) continue;

      const userLink = root.querySelector('a[href^="/@"]');
      const authorFromHref = (userLink?.getAttribute('href') || '').replace(/^\\/@/, '').split(/[/?#]/)[0] || '';
      const authorFromLabel = (root.querySelector('[data-e2e="comment-username-1"]')?.textContent || '').trim();
      const author = authorFromHref || authorFromLabel.replace(/\\s+/g, '').slice(0, 40);
      const text = (textEl.innerText || textEl.textContent || '').trim();
      if (!author || !text) continue;

      const key = __jarvisKey(authorFromHref || author, text);
      if (seenLocal.has(key)) continue;
      seenLocal.add(key);

      const timeEl = root.querySelector('[data-e2e="comment-time-1"]');
      const ageSeconds = __jarvisParseAge(timeEl?.textContent || '');
      const alreadyReplied = hasCreatorReply(root);
      const isOwn = !!(creator && (authorFromHref || author).toLowerCase() === creator);
      if (isOwn) { skippedOwn += 1; continue; }
      if (alreadyReplied) { skippedReplied += 1; continue; }

      comments.push({
        author: authorFromHref || author,
        text,
        key,
        ageSeconds,
        alreadyReplied: false,
        isOwn: false,
      });
    }

    comments.sort((a, b) => a.ageSeconds - b.ageSeconds);
    return {
      platform: 'tiktok',
      creator,
      comments: comments.slice(0, 40),
      debug: { rawFound: seenLocal.size, skippedOwn, skippedReplied, strategy },
    };
  } catch (err) {
    return { platform: 'tiktok', creator: null, comments: [], error: String(err?.message || err) };
  }
})()`;

export const FACEBOOK_SCRAPE = `(() => ({
  platform: 'facebook', creator: null, comments: [],
  error: 'Facebook scraper not wired yet — capture a comments panel first.',
}))()`;

export const YOUTUBE_SCRAPE = `(() => ({
  platform: 'youtube', creator: null, comments: [],
  error: 'YouTube scraper not wired yet — capture a comments panel first.',
}))()`;

export const SCRAPE_SCRIPTS: Record<SocialPlatformId, string> = {
  instagram: INSTAGRAM_SCRAPE,
  tiktok: TIKTOK_SCRAPE,
  facebook: FACEBOOK_SCRAPE,
  youtube: YOUTUBE_SCRAPE,
};

const SCROLL_HELPER = `
  function __jarvisFindScroller(seed) {
    let n = seed;
    while (n && n !== document.body && n !== document.documentElement) {
      const style = window.getComputedStyle(n);
      const oy = style.overflowY;
      if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && n.scrollHeight > n.clientHeight + 40) {
        return n;
      }
      n = n.parentElement;
    }
    return null;
  }
  function __jarvisCountComments(sel) {
    return document.querySelectorAll(sel).length;
  }
`;

/** Scroll the TikTok comments panel to trigger lazy-load of more comments. */
export const TIKTOK_SCROLL_MORE = `(async () => {
  ${SCROLL_HELPER}
  try {
    const sel = '[class*="DivCommentItemContainer"], [data-e2e="comment-level-1"]';
    const before = __jarvisCountComments(sel);
    const seed = document.querySelector('[class*="DivCommentListContainer"], [class*="DivCommentList"], [class*="DivCommentItemContainer"], [data-e2e="comment-level-1"]');
    if (!seed) return { ok: false, before, after: before, grew: false, error: 'No comments list found' };

    const scroller = __jarvisFindScroller(seed);
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      scroller.scrollBy(0, Math.max(280, scroller.clientHeight * 0.85));
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    } else {
      const items = document.querySelectorAll(sel);
      const last = items[items.length - 1];
      last?.scrollIntoView({ block: 'end', inline: 'nearest' });
      window.scrollBy(0, 400);
    }

    await new Promise((r) => setTimeout(r, 1100));
    const after = __jarvisCountComments(sel);
    return { ok: true, before, after, grew: after > before };
  } catch (err) {
    return { ok: false, before: 0, after: 0, grew: false, error: String(err?.message || err) };
  }
})()`;

/** Scroll Instagram comments dialog/list to load more. */
export const INSTAGRAM_SCROLL_MORE = `(async () => {
  ${SCROLL_HELPER}
  try {
    const before = Math.max(
      document.querySelectorAll('li._a9zj').length,
      document.querySelectorAll('ul._a9ym > li').length,
    );
    const seed = document.querySelector('ul._a9ym, li._a9zj, [role="dialog"]');
    if (!seed) return { ok: false, before, after: before, grew: false, error: 'No comments list found' };

    const dialog = document.querySelector('[role="dialog"]');
    const scroller = __jarvisFindScroller(seed) || (dialog ? __jarvisFindScroller(dialog) : null);
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      scroller.scrollBy(0, Math.max(280, scroller.clientHeight * 0.85));
    } else {
      const items = document.querySelectorAll('li._a9zj');
      items[items.length - 1]?.scrollIntoView({ block: 'end' });
    }

    const loadMore = document.querySelector('[aria-label="Load more comments"]')
      || Array.from(document.querySelectorAll('button, [role="button"]'))
        .find((el) => /load more comments/i.test(el.getAttribute('aria-label') || el.textContent || ''));
    if (loadMore) {
      try { loadMore.click(); } catch (e) {
        loadMore.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }

    await new Promise((r) => setTimeout(r, 1100));
    const after = Math.max(
      document.querySelectorAll('li._a9zj').length,
      document.querySelectorAll('ul._a9ym > li').length,
    );
    return { ok: true, before, after, grew: after > before };
  } catch (err) {
    return { ok: false, before: 0, after: 0, grew: false, error: String(err?.message || err) };
  }
})()`;

export const SCROLL_MORE_SCRIPTS: Record<SocialPlatformId, string | null> = {
  instagram: INSTAGRAM_SCROLL_MORE,
  tiktok: TIKTOK_SCROLL_MORE,
  facebook: null,
  youtube: null,
};

function escapeForJsString(value: string): string {
  return JSON.stringify(value);
}

/** Click Reply on a matching Instagram comment, fill the composer, press Post. */
export function instagramPostScript(author: string, commentText: string, reply: string): string {
  return `(async () => {
    const author = ${escapeForJsString(author)};
    const commentText = ${escapeForJsString(commentText)};
    const reply = ${escapeForJsString(reply)};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();

    const items = Array.from(document.querySelectorAll('li._a9zj'));
    let target = null;
    for (const li of items) {
      const links = Array.from(li.querySelectorAll('a[href^="/"]'))
        .map((a) => (a.getAttribute('href') || '').split('/').filter(Boolean)[0]);
      if ((links[0] || '').toLowerCase() !== author.toLowerCase()) continue;
      const body = Array.from(li.querySelectorAll('[dir="auto"]'))
        .map((el) => (el.textContent || '').trim())
        .find((t) => t && norm(t).includes(norm(commentText).slice(0, 40)));
      if (body || norm(li.innerText).includes(norm(commentText).slice(0, 40))) {
        target = li;
        break;
      }
    }
    if (!target) return { success: false, error: 'Comment not found in DOM' };

    const replyBtn = Array.from(target.querySelectorAll('button, [role="button"]'))
      .find((el) => /^reply$/i.test((el.textContent || '').trim()));
    if (replyBtn) {
      replyBtn.click();
      await sleep(350);
    }

    const textarea = document.querySelector('textarea[aria-label*="Add a comment"], textarea[placeholder*="Add a comment"]');
    if (!textarea) return { success: false, error: 'Comment box not found — open the comments panel' };

    textarea.focus();
    const proto = window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(textarea, reply);
    else textarea.value = reply;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);

    const postBtn = Array.from(document.querySelectorAll('div[role="button"], button'))
      .find((el) => /^post$/i.test((el.textContent || '').trim()) && el.getAttribute('aria-disabled') !== 'true');
    if (!postBtn) return { success: false, error: 'Post button not found or disabled' };
    postBtn.click();
    await sleep(600);
    return { success: true };
  })()`;
}

/** Click Reply on a matching TikTok comment, fill Draft.js editor, press Post. */
export function tiktokPostScript(author: string, commentText: string, reply: string): string {
  return `(async () => {
    const author = ${escapeForJsString(author)};
    const commentText = ${escapeForJsString(commentText)};
    const reply = ${escapeForJsString(reply)};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();

    const postDisabled = (btn) => {
      if (!btn) return true;
      if (btn.hasAttribute('disabled')) return true;
      if (btn.getAttribute('aria-disabled') === 'true') return true;
      if (btn.disabled === true) return true;
      return false;
    };

    const fillDraftEditor = async (editor, text) => {
      editor.focus();
      await sleep(80);

      // Clear whatever is already in the box
      try {
        document.execCommand('selectAll', false, undefined);
        document.execCommand('delete', false, undefined);
      } catch { /* ignore */ }
      await sleep(40);

      // 1) Preferred: insertText (Draft.js listens when selection is in the editor)
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, text);
      } catch { inserted = false; }

      // 2) Paste event — Draft.js handles clipboard paste reliably
      if (!inserted || !(editor.innerText || '').trim()) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
          editor.dispatchEvent(paste);
          await sleep(80);
        } catch { /* ignore */ }
      }

      // 3) beforeinput + insertText per chunk (last resort)
      if (!(editor.innerText || '').trim()) {
        editor.focus();
        const before = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text,
        });
        editor.dispatchEvent(before);
        document.execCommand('insertText', false, text);
        editor.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: text,
        }));
      }

      await sleep(120);
      return norm(editor.innerText || '').includes(norm(text).slice(0, Math.min(20, text.length)));
    };

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
    if (!target) return { success: false, error: 'Comment not found in DOM' };

    const replyBtn = target.querySelector('[data-e2e="comment-reply-1"]');
    if (replyBtn) {
      replyBtn.click();
      await sleep(500);
    }

    // Focus the comment input shell first (TikTok mounts Draft.js here)
    document.querySelector('[data-e2e="comment-input"]')?.click();
    await sleep(150);

    const editor = document.querySelector('[data-e2e="comment-input"] .public-DraftEditor-content[contenteditable="true"]')
      || document.querySelector('.public-DraftEditor-content[contenteditable="true"]')
      || document.querySelector('[contenteditable="true"][role="textbox"]');
    if (!editor) return { success: false, error: 'Comment editor not found — open comments first' };

    const filled = await fillDraftEditor(editor, reply);
    if (!filled) {
      return {
        success: false,
        error: 'Could not type into TikTok composer (Draft.js ignored the text). Click the comment box once, then try Send again.',
      };
    }

    const postBtn = document.querySelector('[data-e2e="comment-post"]');
    if (!postBtn) return { success: false, error: 'Post button not found' };

    // Wait for TikTok to enable Post after Draft state updates
    for (let i = 0; i < 12; i++) {
      if (!postDisabled(postBtn)) break;
      await sleep(100);
    }

    if (postDisabled(postBtn)) {
      return {
        success: false,
        error: 'TikTok Post is still disabled — the site did not accept the typed reply. Click the comment box, then Send again.',
      };
    }

    postBtn.click();
    await sleep(700);
    return { success: true };
  })()`;
}

export function postScript(
  platform: SocialPlatformId,
  author: string,
  commentText: string,
  reply: string,
): string | null {
  if (platform === 'instagram') return instagramPostScript(author, commentText, reply);
  if (platform === 'tiktok') return tiktokPostScript(author, commentText, reply);
  return null;
}
