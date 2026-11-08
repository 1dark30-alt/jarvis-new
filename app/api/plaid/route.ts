import { NextRequest, NextResponse } from 'next/server';
import {
  addItem, findItem, listItems, plaidCall, readCreds,
  removeItem, setItemLabel,
} from '../../lib/server/plaid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Finance — Plaid-powered bank data for the Finance screen.
 *
 * ops:
 *   link_token            create a Plaid Link token (for the Link widget)
 *   exchange              exchange Link's public token → stored connection
 *   items                 list connected banks (+ labels)
 *   set_label             mark a connection business | personal
 *   remove                forget a connection
 *   accounts              all accounts across connections, with balances
 *   transactions          recent transactions across connections
 *   summary               spending by category, business/personal split,
 *                         and detected subscriptions
 */

interface Txn {
  account_id: string;
  amount: number;
  date: string;
  name: string;
  merchant_name?: string | null;
  category?: string[];
  pending?: boolean;
}

function credsOrFail() {
  const creds = readCreds();
  if (!creds) {
    throw Object.assign(new Error('Plaid is not configured. Add your client_id and secret in Settings → Finance.'), { status: 400 });
  }
  return creds;
}

function handle(err: unknown) {
  const e = err as { status?: number; message?: string };
  return NextResponse.json({ error: e.message ?? String(err) }, { status: e.status ?? 500 });
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const SKIP_CATEGORIES = new Set(['Transfer', 'Payment', 'Loan', 'Deposit', 'Payroll', 'Withdrawal']);

function merchantKey(t: Txn): string {
  const raw = (t.merchant_name ?? t.name ?? '').toLowerCase();
  // Strip dates/reference numbers so recurring charges group together.
  return raw.replace(/\d{4,}/g, '').replace(/[#*]+\d+/g, '').replace(/\s+/g, ' ').trim() || raw;
}

/** Recurring charges: same merchant, similar amount, steady cadence. */
function detectSubscriptions(txns: Txn[]) {
  const byMerchant = new Map<string, Txn[]>();
  for (const t of txns) {
    if (t.amount <= 0) continue; // income is negative in Plaid
    const key = merchantKey(t);
    if (!key || key.length < 3) continue;
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key)!.push(t);
  }

  const subs: {
    merchant: string; amount: number; occurrences: number;
    cadence: 'weekly' | 'biweekly' | 'monthly' | 'irregular';
    lastDate: string; nextEstimate: string | null; labels: string[];
  }[] = [];

  for (const [key, list] of byMerchant) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((t) => t.amount);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    // Similar amounts only (±20%) — different amounts at one merchant are
    // just shopping, not a subscription.
    if (amounts.some((a) => Math.abs(a - avg) / avg > 0.2)) continue;

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push((new Date(sorted[i].date).getTime() - new Date(sorted[i - 1].date).getTime()) / 86_400_000);
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const steady = gaps.every((g) => Math.abs(g - avgGap) <= Math.max(4, avgGap * 0.25));
    if (!steady) continue;

    let cadence: 'weekly' | 'biweekly' | 'monthly' | 'irregular' = 'irregular';
    if (avgGap >= 6 && avgGap <= 9) cadence = 'weekly';
    else if (avgGap >= 12 && avgGap <= 17) cadence = 'biweekly';
    else if (avgGap >= 25 && avgGap <= 35) cadence = 'monthly';
    if (cadence === 'irregular' && sorted.length < 3) continue;

    const last = sorted[sorted.length - 1];
    const nextEstimate = cadence === 'irregular'
      ? null
      : new Date(new Date(last.date).getTime() + avgGap * 86_400_000).toISOString().slice(0, 10);

    subs.push({
      merchant: (sorted[sorted.length - 1].merchant_name ?? sorted[sorted.length - 1].name).slice(0, 60),
      amount: Math.round(avg * 100) / 100,
      occurrences: sorted.length,
      cadence,
      lastDate: last.date,
      nextEstimate,
      labels: sorted.map((t) => (t as Txn & { _label?: string })._label ?? ''),
    });
  }

  subs.sort((a, b) => b.amount - a.amount);
  return subs;
}

function enrich(txns: Txn[]): (Txn & { _label: string })[] {
  const items = listItems();
  const labelByAccount = new Map<string, string>();
  // /transactions/get returns accounts per item; map account_id → item label
  // lazily via account_id prefix match against the accounts call is expensive —
  // instead each item's transactions are fetched separately below, so the
  // caller tags them. Here we fall back to matching by account_id if provided.
  for (const item of items) {
    labelByAccount.set(item.itemId, item.label);
  }
  return txns.map((t) => ({ ...t, _label: (t as Txn & { _label?: string })._label ?? labelByAccount.get(t.account_id) ?? 'personal' }));
}

export async function POST(req: NextRequest) {
  try {
    const a = (await req.json()) as Record<string, unknown>;
    const op = String(a.op ?? '').trim().toLowerCase();

    // ops that work without credentials configured: none — everything needs Plaid.
    const creds = credsOrFail();

    switch (op) {
      case 'link_token': {
        const data = await plaidCall<{ link_token: string; expiration?: string }>('/link/token/create', creds, {
          user: { client_user_id: `jarvis-${Date.now()}` },
          client_name: 'Jarvis',
          products: ['transactions'],
          country_codes: ['US'],
          language: 'en',
          redirect_uri: 'http://127.0.0.1:3000/finance',
        });
        return NextResponse.json({ ok: true, linkToken: data.link_token });
      }

      case 'exchange': {
        const ex = await plaidCall<{ access_token: string; item_id: string }>('/item/public_token/exchange', creds, {
          public_token: String(a.publicToken ?? ''),
        });
        const institution = String(a.institution ?? 'Bank');
        addItem({
          itemId: ex.item_id,
          accessToken: ex.access_token,
          institution,
          label: (a.label === 'business' ? 'business' : 'personal'),
          createdAt: new Date().toISOString(),
        });
        return NextResponse.json({ ok: true, itemId: ex.item_id, institution });
      }

      case 'items':
        return NextResponse.json({ ok: true, items: listItems().map(({ accessToken, ...rest }) => rest) });

      case 'set_label': {
        const item = setItemLabel(String(a.itemId ?? ''), a.label === 'business' ? 'business' : 'personal');
        return item
          ? NextResponse.json({ ok: true })
          : NextResponse.json({ error: 'No such connection' }, { status: 404 });
      }

      case 'remove': {
        const item = findItem(String(a.itemId ?? ''));
        let revoked = false;
        if (item && creds) {
          try { await plaidCall('/item/remove', creds, { access_token: item.accessToken }); revoked = true; }
          catch { revoked = false; } // revoke is best-effort; forget locally regardless
        }
        return NextResponse.json({ ok: removeItem(String(a.itemId ?? '')), revoked });
      }

      case 'accounts': {
        const results = await Promise.allSettled(
          listItems().map(async (item) => {
            const data = await plaidCall<{
              accounts: { account_id: string; name: string; official_name?: string; mask?: string; type: string; subtype: string; balances: { current: number | null } }[];
              item: { institution?: { name?: string } };
            }>('/accounts/get', creds, { access_token: item.accessToken });
            return data.accounts.map((acc) => ({
              itemId: item.itemId,
              institution: data.item.institution?.name ?? item.institution,
              label: item.label,
              accountId: acc.account_id,
              name: acc.official_name ?? acc.name,
              mask: acc.mask ?? '',
              type: acc.type,
              subtype: acc.subtype,
              balance: acc.balances.current,
            }));
          }),
        );
        const accounts = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
        const failed = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason).slice(0, 120));
        return NextResponse.json({ ok: true, accounts, failed });
      }

      case 'transactions':
      case 'summary': {
        const days = Math.max(7, Math.min(365, Number(a.days ?? (op === 'summary' ? 30 : 30))));
        const startDate = daysAgoIso(days);
        const endDate = daysAgoIso(0);

        const all: (Txn & { _label: string; _institution: string })[] = [];
        const failed: string[] = [];

        for (const item of listItems()) {
          try {
            let offset = 0;
            for (;;) {
              const data = await plaidCall<{
                transactions: Txn[];
                accounts: { account_id: string; name: string; mask?: string }[];
                total_transactions?: number;
              }>('/transactions/get', creds, {
                access_token: item.accessToken,
                start_date: startDate,
                end_date: endDate,
                options: { count: 100, offset },
              });
              for (const t of data.transactions ?? []) {
                const acc = data.accounts.find((x) => x.account_id === t.account_id);
                all.push({ ...t, _label: item.label, _institution: `${item.institution}${acc?.mask ? ` ••${acc.mask}` : ''}` });
              }
              offset += 100;
              if (!data.transactions?.length || all.length >= (data.total_transactions ?? 0)) break;
            }
          } catch (e) {
            failed.push(`${item.institution}: ${String(e).slice(0, 120)}`);
          }
        }

        const txns: (Txn & { _label: string; _institution: string })[] = enrich(all);
        const expenses = txns.filter((t) => t.amount > 0);

        const byCategory = new Map<string, number>();
        for (const t of expenses) {
          const cat = t.category?.length ? t.category[t.category.length - 1] : 'Other';
          if (SKIP_CATEGORIES.has(t.category?.[0] ?? '')) continue;
          byCategory.set(cat, (byCategory.get(cat) ?? 0) + t.amount);
        }
        const spendingByCategory = [...byCategory.entries()]
          .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
          .sort((x, y) => y.total - x.total);

        const split = { business: 0, personal: 0 };
        for (const t of expenses) {
          if (SKIP_CATEGORIES.has(t.category?.[0] ?? '')) continue;
          split[t._label === 'business' ? 'business' : 'personal'] += t.amount;
        }

        if (op === 'summary') {
          return NextResponse.json({
            ok: true,
            days,
            totalSpent: Math.round(expenses.filter((t) => !SKIP_CATEGORIES.has(t.category?.[0] ?? '')).reduce((s, t) => s + t.amount, 0) * 100) / 100,
            spendingByCategory,
            split: { business: Math.round(split.business * 100) / 100, personal: Math.round(split.personal * 100) / 100 },
            subscriptions: detectSubscriptions(txns),
            transactionCount: txns.length,
            failed,
          });
        }

        return NextResponse.json({
          ok: true,
          days,
          transactions: txns
            .sort((x, y) => y.date.localeCompare(x.date))
            .slice(0, 300)
            .map((t) => ({
              date: t.date,
              name: (t.merchant_name ?? t.name).slice(0, 60),
              amount: t.amount,
              category: t.category?.[t.category.length - 1] ?? 'Other',
              label: t._label,
              institution: t._institution,
              pending: Boolean(t.pending),
            })),
          failed,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown op: ${op || '(none)'}` }, { status: 400 });
    }
  } catch (err) {
    return handle(err);
  }
}