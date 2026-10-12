import { describe, expect, test } from 'bun:test';
import {
  COMPACT_CONFIG_WIRE_PATH,
  COMPACT_PANEL_PATH,
  installCompactBroker,
  isTrustedCompactResource,
  parseCompactRequest,
  type CompactBrokerDependencies,
  type CompactRequest,
} from '../src/features/plugins/compactBroker';

const origin = 'https://panel.example';
const panel = origin + COMPACT_PANEL_PATH;
class Port {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  sent: unknown[] = [];
  closed = false;
  starts = 0;
  postMessage(value: unknown) {
    this.sent.push(value);
  }
  start() {
    this.starts += 1;
  }
  close() {
    this.closed = true;
  }
  send(value: unknown) {
    this.onmessage?.({ data: value } as MessageEvent<unknown>);
  }
}
const drain = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
function fixture(overrides: Partial<CompactBrokerDependencies> = {}) {
  let message: ((event: MessageEvent<unknown>) => void) | null = null;
  let authListener = () => {};
  let themeListener = () => {};
  let revision = 1;
  let authenticated = true;
  let confirmResolve: ((value: 'confirmed' | 'canceled' | 'busy') => void) | null = null;
  let confirmCalls = 0;
  let canceled = 0;
  const requests: { request: CompactRequest; revision: number; signal: AbortSignal }[] = [];
  const channels: { port1: Port; port2: Port }[] = [];
  const ready: { value: unknown; origin: string; ports: Transferable[] }[] = [];
  const child = {
    location: { href: panel + '#config' },
    postMessage: (value: unknown, targetOrigin: string, ports: Transferable[]) =>
      ready.push({ value, origin: targetOrigin, ports }),
  };
  const frame = { src: panel, contentWindow: child, contentDocument: {} };
  const host = {
    addEventListener: (_type: string, listener: EventListener) => {
      message = listener as unknown as (event: MessageEvent<unknown>) => void;
    },
    removeEventListener: () => {
      message = null;
    },
  } as unknown as CompactBrokerDependencies['host'];
  const deps: CompactBrokerDependencies = {
    host,
    origin,
    pluginID: 'claude-compact',
    iframeSrc: panel,
    apiBase: origin,
    getFrame: () => frame as unknown as HTMLIFrameElement,
    isAuthenticated: () => authenticated,
    getRevision: () => revision,
    getTheme: () => 'white',
    createChannel: () => {
      const channel = { port1: new Port(), port2: new Port() };
      channels.push(channel);
      return channel as unknown as MessageChannel;
    },
    request: async (request, rev, signal) => {
      requests.push({ request, revision: rev, signal });
      return { enabled: true };
    },
    confirm: () => {
      confirmCalls += 1;
      return new Promise((resolve) => {
        confirmResolve = resolve;
      });
    },
    cancelConfirmation: () => {
      canceled += 1;
    },
    subscribeAuth: (listener) => {
      authListener = listener;
      return () => {
        authListener = () => {};
      };
    },
    subscribeTheme: (listener) => {
      themeListener = listener;
      return () => {
        themeListener = () => {};
      };
    },
    ...overrides,
  };
  const cleanup = installCompactBroker(deps);
  return {
    frame,
    child,
    channels,
    ready,
    requests,
    cleanup,
    hello: (patch: Partial<MessageEvent<unknown>> = {}) =>
      message?.({
        data: { channel: 'cpa-plugin-broker', type: 'hello', v: 1 },
        source: child,
        origin,
        ports: [],
        ...patch,
      } as unknown as MessageEvent<unknown>),
    confirm: (value: 'confirmed' | 'canceled' | 'busy') => confirmResolve?.(value),
    confirmCalls: () => confirmCalls,
    canceled: () => canceled,
    switchSession: () => {
      revision += 1;
      authListener();
    },
    logout: () => {
      authenticated = false;
      authListener();
    },
    theme: () => themeListener(),
    listenerPresent: () => message !== null,
  };
}
const wire = (id: number, method = 'GET', path = COMPACT_CONFIG_WIRE_PATH, extras = {}) => ({
  id,
  method,
  path,
  ...extras,
});

describe('Compact 固定资源与请求白名单', () => {
  test('只接同源精确内置资源，其他插件/路径/跨源/凭据URL拒绝', () => {
    expect(isTrustedCompactResource('claude-compact', panel, origin, origin)).toBe(true);
    for (const args of [
      ['other', panel, origin],
      ['claude-compact', panel + '?x=1', origin],
      ['claude-compact', panel + '/', origin],
      ['claude-compact', panel, 'https://else.example'],
      ['claude-compact', panel, 'https://user:pass@panel.example'],
      ['claude-compact', panel, origin + '/gateway'],
    ])
      expect(isTrustedCompactResource(args[0], args[1], args[2], origin)).toBe(false);
  });
  test('config 显式映射 v8，status/events 仅固定本源 custom URL', () => {
    expect(parseCompactRequest(wire(1), origin)?.url).toBe(
      '/config/plugins/configs/claude-compact'
    );
    expect(
      parseCompactRequest(wire(2, 'GET', '/v0/management/claude-compact/status'), origin)?.url
    ).toBe(origin + '/v0/management/claude-compact/status');
    expect(
      parseCompactRequest(
        wire(3, 'GET', '/v0/management/claude-compact/events', {
          query: { limit: '100', offset: '20' },
        }),
        origin
      )?.query
    ).toEqual({ limit: 100, offset: 20 });
  });
  test('PUT整份快照保留false/0/空预算/prefix，不做merge或转换', () => {
    const body = {
      enabled: false,
      protocol: '',
      ttl_hours: 0,
      capacity: 0,
      max_bytes_mb: 0,
      default_budget: 0,
      model_budgets: {},
      supported_model_prefixes: ['gpt-', 'claude-'],
      observability: { enabled: false, retention_days: 0, max_events: 0, max_bytes_mb: 0 },
    };
    const request = parseCompactRequest(wire(1, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body }), origin);
    expect(request?.method).toBe('PUT');
    expect(request?.body).toEqual(body);
    expect(request?.body).not.toBe(body);
  });
  test('拒绝任意URL、方法、headers、额外query、超大/无效body', () => {
    for (const value of [
      wire(1, 'GET', 'https://attacker.example'),
      wire(1, 'DELETE'),
      wire(1, 'GET', COMPACT_CONFIG_WIRE_PATH, { headers: { Authorization: 'fixture' } }),
      wire(1, 'GET', COMPACT_CONFIG_WIRE_PATH, { query: {} }),
      wire(1, 'GET', '/v0/management/claude-compact/events', { query: { limit: 201 } }),
      wire(1, 'GET', '/v0/management/claude-compact/events', { query: { limit: '1.5' } }),
      wire(1, 'GET', '/v0/management/claude-compact/events', { query: { offset: -1 } }),
      wire(1, 'GET', '/v0/management/claude-compact/events', { query: { url: 'bad' } }),
      wire(1, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body: null }),
      wire(1, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body: { api_key: 'fixture' } }),
      wire(1, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body: { protocol: 'x'.repeat(65_536) } }),
    ])
      expect(parseCompactRequest(value, origin)).toBeNull();
  });
});

describe('Compact 受信端口与异步生命周期', () => {
  test('错误来源/协议不回ready；合法握手回单端口且主题明确，重复hello不换port', () => {
    const f = fixture();
    f.hello({ origin: 'null' });
    f.hello({ origin: 'https://else.example' });
    f.hello({ source: null });
    f.hello({ data: { channel: 'cpa-plugin-broker', type: 'hello', v: 2 } });
    expect(f.channels).toHaveLength(0);
    f.hello();
    f.hello();
    expect(f.channels).toHaveLength(1);
    expect(f.ready).toHaveLength(1);
    expect(f.ready[0].origin).toBe(origin);
    expect(f.ready[0].ports).toHaveLength(1);
    expect(f.ready[0].value).toEqual({
      channel: 'cpa-plugin-broker',
      type: 'ready',
      v: 1,
      theme: 'white',
    });
    f.cleanup();
    expect(f.channels[0].port1.closed).toBe(true);
    expect(f.listenerPresent()).toBe(false);
  });
  test('其他资源完全不新增broker listener', () => {
    const f = fixture({ pluginID: 'other' });
    f.hello();
    expect(f.listenerPresent()).toBe(false);
    expect(f.channels).toHaveLength(0);
  });
  test('GET自动代发、主题更新；线协议不含原始密钥/headers', async () => {
    const f = fixture();
    f.hello();
    const port = f.channels[0].port1;
    port.send(wire(1));
    await drain();
    f.theme();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].revision).toBe(1);
    expect(port.sent).toContainEqual({ id: 1, ok: true, data: { enabled: true } });
    expect(port.sent).toContainEqual({ type: 'theme', theme: 'white' });
    expect(JSON.stringify([...f.ready, ...port.sent])).not.toContain('Authorization');
    f.cleanup();
  });
  test('GET裸对象原样回传observability.raw、false与0', async () => {
    const payload = {
      enabled: false,
      ttl_hours: 0,
      observability: { enabled: false, raw: { retention_days: 0, max_events: 0, max_bytes_mb: 0 } },
    };
    const f = fixture({ request: async () => payload });
    f.hello();
    const port = f.channels[0].port1;
    port.send(wire(1));
    await drain();
    expect(port.sent).toEqual([{ id: 1, ok: true, data: payload }]);
    f.cleanup();
  });
  test('PUT须确认；并发写busy，不覆盖首个确认；取消零HTTP', async () => {
    const f = fixture();
    f.hello();
    const port = f.channels[0].port1;
    port.send(wire(1, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body: { default_budget: 100 } }));
    port.send(wire(2, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body: { default_budget: 200 } }));
    expect(f.confirmCalls()).toBe(1);
    expect(f.requests).toHaveLength(0);
    expect(port.sent).toContainEqual({ id: 2, ok: false, error: 'busy' });
    f.confirm('canceled');
    await drain();
    expect(f.requests).toHaveLength(0);
    expect(port.sent).toContainEqual({ id: 1, ok: false, error: 'canceled' });
    f.cleanup();
  });
  test('pending同ID重放忽略，不提前回复busy；不同ID仍可合法确认', async () => {
    const f = fixture();
    f.hello();
    const port = f.channels[0].port1;
    const request = wire(7, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body: { default_budget: 100 } });
    port.send(request);
    port.send(request);
    expect(f.confirmCalls()).toBe(1);
    expect(f.requests).toHaveLength(0);
    expect(port.sent).toHaveLength(0);
    f.confirm('confirmed');
    await drain();
    port.send(request);
    await drain();
    expect(f.confirmCalls()).toBe(1);
    expect(f.requests).toHaveLength(1);
    expect(port.sent).toHaveLength(1);
    port.send(wire(8, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body: { default_budget: 200 } }));
    expect(f.confirmCalls()).toBe(2);
    f.confirm('confirmed');
    await drain();
    expect(f.requests).toHaveLength(2);
    f.frame.contentDocument = {};
    f.hello();
    const next = f.channels[1].port1;
    next.send(request);
    expect(f.confirmCalls()).toBe(3);
    f.confirm('confirmed');
    await drain();
    expect(f.requests).toHaveLength(3);
    f.cleanup();
  });
  test('成功/取消/busy/错误已处理ID均不能再次确认或HTTP', async () => {
    for (const result of ['confirmed', 'canceled', 'busy', 'failed'] as const) {
      let confirmations = 0,
        puts = 0;
      const f = fixture({
        confirm: async () => {
          confirmations += 1;
          return result === 'failed' ? 'confirmed' : result;
        },
        request: async () => {
          puts += 1;
          if (result === 'failed') throw new Error('fixture failure');
          return {};
        },
      });
      f.hello();
      const port = f.channels[0].port1;
      const request = wire(7, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body: { default_budget: 100 } });
      port.send(request);
      await drain();
      const responses = port.sent.length;
      port.send(request);
      port.send({ ...request, body: { default_budget: 900 } });
      await drain();
      expect(confirmations).toBe(1);
      expect(puts).toBe(result === 'confirmed' || result === 'failed' ? 1 : 0);
      expect(port.sent).toHaveLength(responses);
      f.cleanup();
    }
  });
  test('确认后仅一次PUT，传输的是确认前配置快照', async () => {
    const f = fixture();
    f.hello();
    const port = f.channels[0].port1;
    const body = { default_budget: 100 };
    port.send(wire(1, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body }));
    body.default_budget = 900;
    f.confirm('confirmed');
    await drain();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].request.body).toEqual({ default_budget: 100 });
    f.cleanup();
  });
  test('确认期间换账号/登出均零HTTP；旧确认不能重启写入', async () => {
    for (const action of ['switchSession', 'logout'] as const) {
      const f = fixture();
      f.hello();
      const port = f.channels[0].port1;
      port.send(wire(1, 'PUT', COMPACT_CONFIG_WIRE_PATH, { body: { default_budget: 100 } }));
      f[action]();
      f.confirm('confirmed');
      await drain();
      expect(f.requests).toHaveLength(0);
      expect(port.closed).toBe(true);
      expect(f.canceled()).toBeGreaterThan(0);
    }
  });
  test('iframe重载建立新代际，旧GET迟到不覆盖新回复，旧请求被abort', async () => {
    const resolves: ((value: unknown) => void)[] = [];
    const signals: AbortSignal[] = [];
    const f = fixture({
      request: (_request, _revision, signal) => {
        signals.push(signal);
        return new Promise((resolve) => resolves.push(resolve));
      },
    });
    f.hello();
    const old = f.channels[0].port1;
    old.send(wire(1));
    f.frame.contentDocument = {};
    f.hello();
    const current = f.channels[1].port1;
    expect(old.closed).toBe(true);
    expect(signals[0].aborted).toBe(true);
    current.send(wire(1));
    resolves[0]({ stale: true });
    await drain();
    expect(current.sent).toHaveLength(0);
    resolves[1]({ fresh: true });
    await drain();
    expect(current.sent).toEqual([{ id: 1, ok: true, data: { fresh: true } }]);
    f.cleanup();
  });
  test('错误只回固定类别，不转发后端原始串', async () => {
    const f = fixture({
      request: async () => {
        throw { status: 401, message: 'fixture-secret-error' };
      },
    });
    f.hello();
    const port = f.channels[0].port1;
    port.send(wire(1));
    await drain();
    expect(port.sent).toEqual([{ id: 1, ok: false, error: 'auth_required', status: 401 }]);
    expect(JSON.stringify(port.sent)).not.toContain('fixture-secret-error');
    f.cleanup();
  });
});
