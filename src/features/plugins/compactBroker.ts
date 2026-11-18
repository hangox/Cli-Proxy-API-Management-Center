// 仅为列出的同源插件页面代发请求；凭据由父侧 API client 持有。
export const COMPACT_PANEL_PATH = '/v0/resource/plugins/claude-compact/panel';
export const ADVISOR_PANEL_PATH = '/v0/resource/plugins/advisor/index.html';
export const COMPACT_CONFIG_WIRE_PATH = '/v0/management/plugins/claude-compact/config';
const CONFIG_PATH = '/config/plugins/configs/claude-compact';
const STATUS_PATH = '/v0/management/claude-compact/status';
const EVENTS_PATH = '/v0/management/claude-compact/events';
const CHANNEL = 'cpa-plugin-broker';
const VERSION = 1;
export type CompactTheme = 'white' | 'light' | 'dark';
type Decision = 'confirmed' | 'canceled' | 'busy';
export interface CompactRequest {
  id: number;
  method: 'GET' | 'PUT';
  url: string;
  body?: Record<string, unknown>;
  query?: Record<string, number | string>;
}
export interface CompactBrokerDependencies {
  host: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  origin: string;
  pluginID: string;
  iframeSrc: string;
  apiBase: string;
  getFrame: () => HTMLIFrameElement | null;
  isAuthenticated: () => boolean;
  getRevision: () => number;
  getTheme: () => CompactTheme;
  createChannel: () => MessageChannel;
  request: (request: CompactRequest, revision: number, signal: AbortSignal) => Promise<unknown>;
  confirm: () => Promise<Decision>;
  cancelConfirmation: () => void;
  subscribeAuth: (listener: () => void) => () => void;
  subscribeTheme: (listener: () => void) => () => void;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isTrustedPluginResource(
  pluginID: string,
  iframeSrc: string,
  apiBase: string,
  origin: string
): boolean {
  const panelPath = trustedPanelPath(pluginID);
  if (!panelPath) return false;
  try {
    const api = new URL(apiBase);
    return (
      iframeSrc === new URL(panelPath, origin).href &&
      api.origin === origin &&
      api.pathname === '/' &&
      !api.search &&
      !api.hash &&
      !api.username &&
      !api.password
    );
  } catch {
    return false;
  }
}

function trustedPanelPath(pluginID: string): string | undefined {
  if (pluginID === 'claude-compact') return COMPACT_PANEL_PATH;
  if (pluginID === 'advisor') return ADVISOR_PANEL_PATH;
}

const advisorPrefix = '/v0/management/plugins/advisor/';
const advisorQueries: ReadonlyMap<string, readonly string[]> = new Map([
  [advisorPrefix + 'sessions', ['cursor']],
  [advisorPrefix + 'consultations', ['cursor', 'session_id', 'unassociated']],
  [advisorPrefix + 'consultation', ['id']],
  [advisorPrefix + 'statistics', ['period']],
]);

function parseAdvisorRequest(
  value: Record<string, unknown>,
  origin: string
): CompactRequest | null {
  const { id, method, path, query } = value;
  if (
    method !== 'GET' ||
    typeof path !== 'string' ||
    Object.keys(value).some((key) => !['id', 'method', 'path', 'query'].includes(key)) ||
    (query !== undefined && !record(query))
  )
    return null;
  const keys = advisorQueries.get(path);
  if (!keys) return null;
  const parsed: Record<string, string> = {};
  for (const [key, raw] of Object.entries(query ?? {})) {
    if (!keys.includes(key) || typeof raw !== 'string') return null;
    if (key === 'unassociated' && raw !== 'true') return null;
    if (key === 'period' && !['24h', '7d', '30d'].includes(raw)) return null;
    parsed[key] = raw;
  }
  return { id: Number(id), method, url: new URL(path, origin).href, query: parsed };
}

// 子页旧 wire 名只映射到这三个已确认端点，不接受 URL、headers 或任意 query 透传。
export function parseCompactRequest(value: unknown, origin: string): CompactRequest | null {
  if (!record(value) || !Number.isSafeInteger(value.id) || Number(value.id) <= 0) return null;
  if (Object.keys(value).some((key) => !['id', 'method', 'path', 'body', 'query'].includes(key)))
    return null;
  const { id, method, path, body, query } = value;
  if (
    method === 'GET' &&
    path === COMPACT_CONFIG_WIRE_PATH &&
    body === undefined &&
    query === undefined
  ) {
    return { id: Number(id), method, url: CONFIG_PATH };
  }
  if (method === 'GET' && path === STATUS_PATH && body === undefined && query === undefined) {
    return { id: Number(id), method, url: new URL(STATUS_PATH, origin).href };
  }
  if (method === 'GET' && path === EVENTS_PATH && body === undefined) {
    if (query !== undefined && !record(query)) return null;
    const fields = query ?? {};
    if (Object.keys(fields).some((key) => !['limit', 'offset'].includes(key))) return null;
    const parsed: Record<string, number> = {};
    for (const key of Object.keys(fields)) {
      const raw = fields[key];
      if (!(typeof raw === 'string' && /^\d+$/.test(raw)) && typeof raw !== 'number') return null;
      const n = Number(raw);
      if (!Number.isSafeInteger(n) || n < 0 || (key === 'limit' ? n < 1 || n > 200 : n > 1_000_000))
        return null;
      parsed[key] = n;
    }
    return { id: Number(id), method, url: new URL(EVENTS_PATH, origin).href, query: parsed };
  }
  if (method !== 'PUT' || path !== COMPACT_CONFIG_WIRE_PATH || query !== undefined || !record(body))
    return null;
  const fields = [
    'enabled',
    'protocol',
    'ttl_hours',
    'capacity',
    'max_bytes_mb',
    'model_budgets',
    'default_budget',
    'supported_model_prefixes',
    'observability',
  ];
  if (Object.keys(body).some((key) => !fields.includes(key))) return null;
  try {
    // 快照在等待用户确认前固定，避免同一个请求在确认期间改变内容。
    const encoded = JSON.stringify(body);
    if (new TextEncoder().encode(encoded).length > 65_536) return null;
    return {
      id: Number(id),
      method,
      url: CONFIG_PATH,
      body: JSON.parse(encoded) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export function installPluginBroker(deps: CompactBrokerDependencies): () => void {
  if (!isTrustedPluginResource(deps.pluginID, deps.iframeSrc, deps.apiBase, deps.origin))
    return () => {};
  const panelPath = trustedPanelPath(deps.pluginID);
  const isAdvisor = panelPath === ADVISOR_PANEL_PATH;
  const revision = deps.getRevision();
  let disposed = false;
  let port: MessagePort | null = null;
  let documentToken: Document | null = null;
  let writeBusy = false;
  let generation = 0;
  let highestID = 0;
  const pending = new Map<number, AbortController>();
  let unsubscribeAuth = () => {};
  let unsubscribeTheme = () => {};

  function trustedFrame(): HTMLIFrameElement | null {
    try {
      const frame = deps.getFrame();
      if (!frame || frame.src !== deps.iframeSrc || !frame.contentWindow) return null;
      const actual = new URL(frame.contentWindow.location.href);
      if (
        actual.origin !== deps.origin ||
        actual.pathname !== panelPath ||
        actual.search ||
        (!isAdvisor && !['', '#config', '#status', '#events'].includes(actual.hash))
      )
        return null;
      return frame;
    } catch {
      return null;
    }
  }
  function sessionValid(): boolean {
    return !disposed && deps.isAuthenticated() && deps.getRevision() === revision;
  }
  function live(): boolean {
    const frame = trustedFrame();
    return (
      sessionValid() &&
      Boolean(frame && (!documentToken || frame.contentDocument === documentToken))
    );
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    deps.host.removeEventListener('message', handshake);
    unsubscribeAuth();
    unsubscribeTheme();
    closeChannel();
  }
  function closeChannel() {
    generation += 1;
    highestID = 0;
    writeBusy = false;
    documentToken = null;
    deps.cancelConfirmation();
    for (const controller of pending.values()) controller.abort();
    pending.clear();
    if (port) {
      try {
        port.postMessage({ type: 'closed' });
      } catch {
        /* 已关闭的端口无需再次通知。 */
      }
      port.onmessage = null;
      port.close();
      port = null;
    }
  }
  function reply(id: number, value: Record<string, unknown>, requestGeneration = generation) {
    if (requestGeneration !== generation) return;
    if (!live()) {
      if (sessionValid()) closeChannel();
      else dispose();
      return;
    }
    port?.postMessage({ id, ...value });
  }
  async function receive(event: MessageEvent<unknown>) {
    if (!live()) {
      if (sessionValid()) closeChannel();
      else dispose();
      return;
    }
    const requestGeneration = generation;
    if (!record(event.data) || !Number.isSafeInteger(event.data.id) || Number(event.data.id) <= 0)
      return;
    const id = Number(event.data.id);
    // 子页 seq 递增且 MessagePort 保序；高水位既去重又避免无界保存全部请求 ID。
    // pending 重放也直接忽略，不能先用同 ID busy 结束子页 promise，再继续原写操作。
    if (id <= highestID) return;
    highestID = id;
    const request = isAdvisor
      ? parseAdvisorRequest(event.data, deps.origin)
      : parseCompactRequest(event.data, deps.origin);
    if (!request) {
      if (record(event.data) && Number.isSafeInteger(event.data.id))
        reply(Number(event.data.id), { ok: false, error: 'invalid_request' });
      return;
    }
    if (pending.size >= 16 || (request.method === 'PUT' && writeBusy)) {
      reply(request.id, { ok: false, error: 'busy' });
      return;
    }
    const controller = new AbortController();
    pending.set(request.id, controller);
    if (request.method === 'PUT') writeBusy = true;
    try {
      if (request.method === 'PUT') {
        const decision = await deps.confirm();
        if (requestGeneration !== generation) return;
        if (!live()) {
          if (sessionValid()) closeChannel();
          else dispose();
          return;
        }
        if (decision !== 'confirmed') {
          reply(request.id, { ok: false, error: decision });
          return;
        }
      }
      if (requestGeneration !== generation || !live()) return;
      const data = await deps.request(request, revision, controller.signal);
      reply(request.id, { ok: true, data }, requestGeneration);
    } catch (error: unknown) {
      const status = record(error) && typeof error.status === 'number' ? error.status : undefined;
      const unauthorized = status === 401 || (isAdvisor && status === 403);
      reply(
        request.id,
        {
          ok: false,
          error: unauthorized ? 'auth_required' : 'request_failed',
          ...(unauthorized || isAdvisor ? { status } : {}),
        },
        requestGeneration
      );
    } finally {
      if (pending.get(request.id) === controller) pending.delete(request.id);
      if (requestGeneration === generation && request.method === 'PUT') writeBusy = false;
    }
  }
  function handshake(event: MessageEvent<unknown>) {
    if (
      disposed ||
      event.origin !== deps.origin ||
      !record(event.data) ||
      event.data.channel !== CHANNEL ||
      event.data.type !== 'hello' ||
      event.data.v !== VERSION ||
      event.ports.length !== 0
    )
      return;
    const frame = trustedFrame();
    if (!frame || event.source !== frame.contentWindow || !sessionValid() || !frame.contentDocument)
      return;
    if (port && frame.contentDocument === documentToken) return;
    if (port) closeChannel();
    documentToken = frame.contentDocument;
    const channel = deps.createChannel();
    port = channel.port1;
    port.onmessage = (message) => {
      if (port === channel.port1) void receive(message);
    };
    port.start();
    frame.contentWindow!.postMessage(
      { channel: CHANNEL, type: 'ready', v: VERSION, theme: deps.getTheme() },
      deps.origin,
      [channel.port2]
    );
  }
  deps.host.addEventListener('message', handshake as EventListener);
  unsubscribeAuth = deps.subscribeAuth(() => {
    if (!sessionValid()) dispose();
  });
  unsubscribeTheme = deps.subscribeTheme(() => {
    if (!live()) {
      if (sessionValid()) closeChannel();
      else dispose();
      return;
    }
    port?.postMessage({ type: 'theme', theme: deps.getTheme() });
  });
  return dispose;
}
