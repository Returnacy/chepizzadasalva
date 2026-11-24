import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

// Who is logged in is the test's to decide.
const auth = vi.hoisted(() => ({ state: { user: null as any, isLoading: false } }));
vi.mock('../../hooks/use-auth', () => ({ useAuth: () => auth.state }));

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../lib/posthog', () => analytics);

// The real toast, observed.
vi.mock('../../hooks/use-toast', async (importOriginal) => {
  const real: any = await importOriginal();
  return { ...real, toast: vi.fn(real.toast) };
});

import { toast } from '../../hooks/use-toast';
import { HandoffProvider } from './HandoffProvider';
import {
  captureHandoffFromUrl,
  clearPendingHandoff,
  getPendingHandoff,
  hasPendingHandoff,
  isValidHandoffTarget,
  resetHandoffInFlight,
} from './handoff';

const TARGET = 'promo-site';
const DEST = 'https://promo.example.com/handoff';
const HANDOFF_TOKEN = 'h4nd0ff.t0k3n.s3cr3t';
const USER = {
  id: 'user-1',
  profile: { name: 'Mario' },
  userAgreement: { termsOfService: true, privacyPolicy: true },
};

type Reply = { status: number; body?: unknown } | Error;
let replies: Record<string, Reply[]>;
let fetchMock: ReturnType<typeof vi.fn>;

function reply(status: number, body?: unknown): Reply {
  return { status, body };
}

// Routes by path; each path answers its queued replies in order.
function installFetch() {
  fetchMock = vi.fn(async (url: string) => {
    const path = Object.keys(replies).find((p) => url.endsWith(p));
    const next = path ? replies[path].shift() : undefined;
    if (!next) throw new Error(`unexpected fetch ${url}`);
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      statusText: String(next.status),
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => next.body ?? {},
    };
  });
  vi.stubGlobal('fetch', fetchMock);
}

const handoffCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/auth/handoff'));

let submitted: Array<{ action: string; method: string; fields: Record<string, string> }>;

function setPending(target: string, at: number) {
  sessionStorage.setItem('pendingHandoff', JSON.stringify({ target, at }));
}

function renderProvider(children: React.ReactNode = <div>pagina cliente</div>) {
  return render(<HandoffProvider>{children}</HandoffProvider>);
}

function storageValues(): string[] {
  const out: string[] = [];
  for (const store of [sessionStorage, localStorage]) {
    for (let i = 0; i < store.length; i++) out.push(store.getItem(store.key(i)!) ?? '');
  }
  return out;
}

beforeEach(() => {
  clearPendingHandoff(); // also the in-memory mirror
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem('accessToken', 'access-1');
  auth.state = { user: null, isLoading: false };
  replies = {};
  installFetch();
  resetHandoffInFlight();
  analytics.track.mockReset();
  vi.mocked(toast).mockClear();
  submitted = [];
  vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
    const fields: Record<string, string> = {};
    new FormData(this).forEach((v, k) => (fields[k] = String(v)));
    submitted.push({ action: this.action, method: this.method, fields });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('handoff target validation', () => {
  it.each(['promo-site', 'a', 'x1-2-3', 'a'.repeat(40)])('accepts %j', (v) => {
    expect(isValidHandoffTarget(v)).toBe(true);
  });

  it.each(['', 'Promo', 'promo_site', 'promo site', 'a'.repeat(41), '../x', 'https://evil.example.com', 'a/b'])(
    'rejects %j',
    (v) => {
      expect(isValidHandoffTarget(v)).toBe(false);
    },
  );
});

describe('captureHandoffFromUrl', () => {
  it('remembers a valid target and takes it out of the URL, keeping the rest', () => {
    window.history.replaceState({}, '', `/auth?foo=1&handoff=${TARGET}#x=y`);
    captureHandoffFromUrl();
    expect(getPendingHandoff()).toBe(TARGET);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/auth?foo=1#x=y');
  });

  it('ignores anything that is not a target key', () => {
    window.history.replaceState({}, '', '/auth?handoff=https%3A%2F%2Fevil.example.com');
    captureHandoffFromUrl();
    expect(hasPendingHandoff()).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it('expires after 30 minutes and forgets the stale target', () => {
    const now = Date.now();
    setPending(TARGET, now - 31 * 60 * 1000);
    expect(getPendingHandoff(now)).toBeNull();
    expect(sessionStorage.getItem('pendingHandoff')).toBeNull();
    setPending(TARGET, now - 29 * 60 * 1000);
    expect(getPendingHandoff(now)).toBe(TARGET);
  });
});

describe('HandoffProvider — logged in with a pending target', () => {
  it('mints a token for the target and form-POSTs it to the returned url, keeping it out of URLs and storage', async () => {
    setPending(TARGET, Date.now());
    auth.state = { user: USER, isLoading: false };
    replies['/api/v1/auth/handoff'] = [reply(200, { token: HANDOFF_TOKEN, expiresIn: 60, url: DEST })];

    renderProvider();
    expect(screen.getByText('Ti stiamo portando a destinazione…')).toBeTruthy();

    await waitFor(() => expect(submitted).toHaveLength(1));
    const [url, init] = handoffCalls()[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ target: TARGET });
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer access-1');

    expect(submitted[0]).toEqual({ action: DEST, method: 'post', fields: { token: HANDOFF_TOKEN } });
    // Never in a URL, never stored, never left in the DOM, never tracked.
    expect(submitted[0].action).not.toContain(HANDOFF_TOKEN);
    expect(String(url)).not.toContain(HANDOFF_TOKEN);
    expect(window.location.href).not.toContain(HANDOFF_TOKEN);
    expect(storageValues().some((v) => v.includes(HANDOFF_TOKEN))).toBe(false);
    expect(document.querySelector('form')).toBeNull();
    expect(JSON.stringify(analytics.track.mock.calls)).not.toContain(HANDOFF_TOKEN);
    expect(analytics.track).toHaveBeenCalledWith('handoff_started', { target: TARGET, source: 'link' });
    expect(analytics.track).toHaveBeenCalledWith('handoff_submitted', { target: TARGET, source: 'link' });

    // Consumed.
    expect(hasPendingHandoff()).toBe(false);
  });

  it('runs once: re-renders and a second provider do not mint or submit again', async () => {
    setPending(TARGET, Date.now());
    auth.state = { user: USER, isLoading: false };
    replies['/api/v1/auth/handoff'] = [reply(200, { token: HANDOFF_TOKEN, expiresIn: 60, url: DEST })];

    const view = renderProvider();
    renderProvider(); // a second effect run, as StrictMode would do
    view.rerender(<HandoffProvider><div>pagina cliente</div></HandoffProvider>);

    await waitFor(() => expect(submitted).toHaveLength(1));
    await act(async () => {});
    expect(handoffCalls()).toHaveLength(1);
    expect(submitted).toHaveLength(1);
  });

  it('waits for terms and privacy to be accepted', async () => {
    setPending(TARGET, Date.now());
    auth.state = { user: { ...USER, userAgreement: { termsOfService: false, privacyPolicy: false } }, isLoading: false };
    replies['/api/v1/auth/handoff'] = [reply(200, { token: HANDOFF_TOKEN, expiresIn: 60, url: DEST })];

    const view = renderProvider();
    await act(async () => {});
    expect(handoffCalls()).toHaveLength(0);

    auth.state = { user: USER, isLoading: false };
    view.rerender(<HandoffProvider><div>pagina cliente</div></HandoffProvider>);
    await waitFor(() => expect(submitted).toHaveLength(1));
  });

  it('refreshes an expired session once and retries', async () => {
    setPending(TARGET, Date.now());
    localStorage.setItem('refreshToken', 'refresh-1');
    auth.state = { user: USER, isLoading: false };
    replies['/api/v1/auth/handoff'] = [
      reply(401, { error: 'UNAUTHENTICATED' }),
      reply(200, { token: HANDOFF_TOKEN, expiresIn: 60, url: DEST }),
    ];
    replies['/api/v1/auth/refresh'] = [reply(200, { accessToken: 'access-2' })];

    renderProvider();
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(new Headers(handoffCalls()[1][1].headers).get('Authorization')).toBe('Bearer access-2');
  });
});

describe('HandoffProvider — not logged in yet', () => {
  it('keeps the target pending, then hands off once the user arrives', async () => {
    window.history.replaceState({}, '', `/?handoff=${TARGET}`);
    captureHandoffFromUrl();
    replies['/api/v1/auth/handoff'] = [reply(200, { token: HANDOFF_TOKEN, expiresIn: 60, url: DEST })];

    const view = renderProvider();
    await act(async () => {});
    expect(handoffCalls()).toHaveLength(0);
    expect(screen.queryByText('Ti stiamo portando a destinazione…')).toBeNull();
    expect(hasPendingHandoff()).toBe(true);

    // Login lands: useAuth now holds the user.
    auth.state = { user: USER, isLoading: false };
    view.rerender(<HandoffProvider><div>pagina cliente</div></HandoffProvider>);

    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(JSON.parse(handoffCalls()[0][1].body)).toEqual({ target: TARGET });
    expect(hasPendingHandoff()).toBe(false);
  });

  it('does nothing with an expired target', async () => {
    setPending(TARGET, Date.now() - 31 * 60 * 1000);
    auth.state = { user: USER, isLoading: false };
    renderProvider();
    await act(async () => {});
    expect(handoffCalls()).toHaveLength(0);
    expect(screen.getByText('pagina cliente')).toBeTruthy();
    expect(screen.queryByText('Ti stiamo portando a destinazione…')).toBeNull();
  });
});

describe('HandoffProvider — failures never trap the user', () => {
  async function failWith(r: Reply) {
    setPending(TARGET, Date.now());
    auth.state = { user: USER, isLoading: false };
    replies['/api/v1/auth/handoff'] = [r];
    renderProvider();
    await waitFor(() => expect(screen.queryByText('Ti stiamo portando a destinazione…')).toBeNull());
    expect(screen.getByText('pagina cliente')).toBeTruthy();
    expect(submitted).toHaveLength(0);
    expect(hasPendingHandoff()).toBe(false);
  }

  it('404 (unknown target, or a user-service without the route): silent, back to the page', async () => {
    await failWith(reply(404, { error: 'UNKNOWN_HANDOFF_TARGET' }));
    expect(toast).not.toHaveBeenCalled();
    expect(analytics.track).toHaveBeenCalledWith('handoff_failed', {
      target: TARGET,
      source: 'link',
      reason: 'UNKNOWN_HANDOFF_TARGET',
    });
  });

  it('403: the page, plus a short neutral notice', async () => {
    await failWith(reply(403, { error: 'FORBIDDEN' }));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast).mock.calls[0][0].title).toBe('Accesso non consentito');
  });

  it('network error: a notice whose retry tries again, once per click', async () => {
    await failWith(new TypeError('Failed to fetch'));
    expect(toast).toHaveBeenCalledTimes(1);
    const notice: any = vi.mocked(toast).mock.calls[0][0];
    expect(notice.title).toBe('Collegamento non riuscito');
    expect(analytics.track).toHaveBeenCalledWith('handoff_failed', { target: TARGET, source: 'link', reason: 'NETWORK' });

    replies['/api/v1/auth/handoff'] = [reply(200, { token: HANDOFF_TOKEN, expiresIn: 60, url: DEST })];
    await act(async () => notice.action.props.onClick());
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(handoffCalls()).toHaveLength(2);
  });

  it('5xx: same notice with retry', async () => {
    await failWith(reply(502, { error: 'BAD_GATEWAY' }));
    expect(vi.mocked(toast).mock.calls[0][0].title).toBe('Collegamento non riuscito');
  });

  it('a 200 without a usable url is not followed', async () => {
    await failWith(reply(200, { token: HANDOFF_TOKEN, expiresIn: 60, url: 'javascript:alert(1)' }));
    expect(analytics.track).toHaveBeenCalledWith('handoff_failed', {
      target: TARGET,
      source: 'link',
      reason: 'INVALID_RESPONSE',
    });
  });

  it('401 that survives a refresh: session cleared, back to normal login', async () => {
    localStorage.setItem('refreshToken', 'refresh-1');
    replies['/api/v1/auth/refresh'] = [reply(200, { accessToken: 'access-2' })];
    setPending(TARGET, Date.now());
    auth.state = { user: USER, isLoading: false };
    replies['/api/v1/auth/handoff'] = [reply(401, { error: 'UNAUTHENTICATED' }), reply(401, { error: 'UNAUTHENTICATED' })];
    renderProvider();
    await waitFor(() => expect(localStorage.getItem('accessToken')).toBeNull());
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(submitted).toHaveLength(0);
    expect(hasPendingHandoff()).toBe(false);
  });

  it('a failed link is not retried on its own: no loop', async () => {
    await failWith(reply(404, { error: 'UNKNOWN_HANDOFF_TARGET' }));
    await act(async () => {});
    expect(handoffCalls()).toHaveLength(1);
  });
});
