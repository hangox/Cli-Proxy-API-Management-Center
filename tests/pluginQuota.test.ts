import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import { resolveAuthFileQuotaType } from '@/features/authFiles/logic';
import { classifyQuotaFiles, resolveQuotaProviderType } from '@/features/quota/logic';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import {
  PluginQuotaBody,
  type PluginQuotaCardRequestSummary,
} from '@/features/quota/providers/plugin/PluginQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import type { PluginQuotaMetric, PluginQuotaState } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { apiClient } from '@/services/api/client';
import { buildAntigravityQuotaGroups, isPluginQuotaFile } from '@/utils/quota';
import {
  fetchPluginQuota,
  normalizePluginQuotaSummary,
} from '@/features/quota/providers/plugin/data';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test'
);
const renderQuota = (quota: PluginQuotaState) =>
  renderToStaticMarkup(createElement(PluginQuotaBody, { quota, classes }));
const cardClassNames = [
  'pluginQuotaHero',
  'pluginQuotaHeroHead',
  'pluginQuotaHeroLabel',
  'pluginQuotaHeroValue',
  'pluginQuotaOverLimit',
  'pluginQuotaBreakdown',
  'pluginQuotaProgressLabel',
  'pluginQuotaMetricNote',
  'pluginQuotaMetrics',
  'pluginQuotaRequestMetric',
  'pluginQuotaRequestBar',
  'pluginQuotaRequestRateHidden',
  'pluginQuotaDetails',
  'statusBar',
  'statusBlocks',
  'statusBlockWrapper',
  'statusBlock',
  'statusBlockIdle',
  'statusBlockActive',
  'statusTooltip',
  'statusTooltipLeft',
  'statusTooltipRight',
  'tooltipTime',
  'tooltipStats',
  'tooltipSuccess',
  'tooltipFailure',
  'tooltipRate',
  'statusRate',
  'statusRateHigh',
  'statusRateMedium',
  'statusRateLow',
];
const cardStyles = Object.fromEntries(cardClassNames.map((name) => [name, name]));
const requestSummary: PluginQuotaCardRequestSummary = {
  counts: { success: 211, failure: 0 },
  statusData: { blocks: [], blockDetails: [], successRate: 100, totalSuccess: 0, totalFailure: 0 },
  statusBarStyles: cardStyles,
};
const renderCardQuota = (quota: PluginQuotaState, requests = requestSummary) =>
  renderToStaticMarkup(
    createElement(PluginQuotaBody, { quota, classes, cardStyles, requestSummary: requests })
  );
const makeMetric = (
  key: string,
  label: string,
  value: number,
  unit = 'CNY'
): PluginQuotaMetric => ({
  key,
  label,
  value,
  unit,
  format: unit === 'CNY' ? 'currency' : 'number',
  currency: unit === 'CNY' ? 'CNY' : undefined,
});
const makeCardQuota = (summary: PluginQuotaMetric[]): PluginQuotaState => ({
  status: 'success',
  groups: [],
  subscription: { plan: null, tierName: 'CodeMaker', tierId: null },
  summary,
});

describe('generic plugin quota', () => {
  test('routes advertised backend quotas ahead of built-ins on both pages', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({});
    try {
      for (const type of ['claude', 'codex', 'antigravity', 'devin', 'kimi', 'meta', 'xai']) {
        for (const capability of [
          { quota_probe: { url: 'https://quota.example.test/usage' } },
          { quota_provider: type },
        ]) {
          const raw = {
            name: `${type}.json`,
            type,
            supports_quota: true,
            auth_index: '7',
            ...capability,
          };
          const file = normalizeAuthFilesResponse({ files: [raw] }).files[0];
          for (const candidate of [raw, file]) {
            expect(resolveQuotaProviderType(candidate)).toBe('plugin');
            expect(resolveAuthFileQuotaType(candidate, 'all')).toBe('plugin');
            expect(resolveAuthFileQuotaType(candidate, type)).toBe('plugin');
            expect(resolveAuthFileQuotaType(candidate, 'plugin')).toBe('plugin');
            expect(resolveAuthFileQuotaType(candidate, 'unrelated')).toBeNull();
            expect(resolveAuthFileQuotaType(candidate, null)).toBeNull();
            expect(classifyQuotaFiles([{ ...candidate, disabled: true }])).toEqual([]);
          }
          const [entry] = classifyQuotaFiles([file]);
          await QUOTA_ADAPTERS[entry.type].fetchQuota(file, i18n.t);
          expect(post.mock.calls.at(-1)).toEqual([
            '/quota/fetch',
            { auth_index: '7', ...(capability.quota_provider ? { provider: type } : {}) },
          ]);
        }
        for (const supportsQuota of [undefined, false]) {
          const file = { name: `${type}.json`, type, supportsQuota };
          expect(resolveQuotaProviderType(file)).toBe(type);
          expect(resolveAuthFileQuotaType(file, 'all')).toBe(type);
        }
      }
    } finally {
      post.mockRestore();
    }
  });

  test('renders an empty state only without usable summary, subscription or buckets', async () => {
    const post = spyOn(apiClient, 'post');
    try {
      for (const payload of [
        {
          summary: [
            { key: 'balance', label: 'Balance', value: 42, format: 'currency', currency: 'USD' },
          ],
        },
        { summary: [{ key: 'balance', label: 'Balance', value: 0 }] },
        { subscription: { plan: 'Pro' } },
        { subscription: { tierName: 'Premium' } },
        { subscription: { tierId: 'team' } },
        {},
        { subscription: { plan: '  ' }, summary: [{ key: '', label: 'Invalid', value: 42 }] },
      ]) {
        post.mockResolvedValue(payload);
        const data = await fetchPluginQuota({ name: 'quota.json', authIndex: '7' }, i18n.t);
        const markup = renderQuota({ status: 'success', ...data });
        const hasData =
          data.summary.length > 0 || Object.values(data.subscription ?? {}).some(Boolean);
        expect(markup.includes(i18n.t('plugin_quota.empty_data'))).toBe(!hasData);
        for (const metric of data.summary) {
          expect(markup).toContain('>Balance</span>');
          expect(markup).toContain(metric.value === 42 ? '$42.00' : '>0</span>');
        }
      }
    } finally {
      post.mockRestore();
    }
  });

  test('uses readable bucket labels without changing their distinct cache IDs', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      groups: [
        {
          displayName: 'Kiro credits',
          buckets: [
            { window: 'monthly', description: ' Base credits ', remainingFraction: 0.8 },
            { window: 'monthly', description: 'Bonus credits', remainingFraction: 0.2 },
            { window: 'daily', description: ' ', remainingFraction: 0.5 },
            {
              window: 'weekly',
              displayName: 'Explicit label',
              description: 'Details',
              remainingFraction: 0,
            },
          ],
        },
      ],
    });
    try {
      const data = await fetchPluginQuota({ name: 'kiro.json', authIndex: '7' }, i18n.t);
      const buckets = data.groups[0].buckets;
      expect(buckets.find((bucket) => bucket.id === 'kiro-credits-monthly-1')?.label).toBe(
        'Base credits'
      );
      expect(buckets.find((bucket) => bucket.id === 'kiro-credits-monthly-2')?.label).toBe(
        'Bonus credits'
      );
      const markup = renderQuota({ status: 'success', ...data });
      for (const label of ['Base credits', 'Bonus credits', 'daily', 'Explicit label']) {
        expect(markup).toContain(`>${label}</span>`);
      }
      expect(markup).not.toContain('kiro-credits-monthly-');
      expect(markup).not.toContain(i18n.t('plugin_quota.empty_data'));
    } finally {
      post.mockRestore();
    }
  });

  test('renders quota buckets that omit their optional window', () => {
    const markup = renderCardQuota(
      {
        status: 'success',
        subscription: null,
        summary: [],
        groups: [
          {
            id: 'unwindowed',
            label: 'Other quota',
            buckets: [{ id: 'bucket-1', label: 'Unwindowed bucket', remainingFraction: 0.5 }],
          },
        ],
      },
      { ...requestSummary, counts: null }
    );

    expect(markup).toContain('Unwindowed bucket');
    expect(markup).not.toContain(i18n.t('plugin_quota.empty_data'));
  });

  test('accepts capability-only declarative quota probes', () => {
    expect(
      isPluginQuotaFile({ name: 'kiro-a.json', supportsQuota: true, quotaProvider: 'kiro' })
    ).toBe(true);
    expect(isPluginQuotaFile({ name: 'kiro-a.json', supportsQuota: true })).toBe(true);
    expect(getQuotaCacheKey({ name: 'kiro-a.json', supportsQuota: true, authIndex: '7' })).toBe(
      'kiro-a.json' + String.fromCharCode(0) + '7'
    );
  });

  test('keeps only typed, finite summary metrics', () => {
    expect(
      normalizePluginQuotaSummary([
        { key: 'credits_used', label: 'Credits used', value: 1740.28, unit: 'credits' },
        { key: 'charged', label: 'Charged', value: 29.61, format: 'currency', currency: 'USD' },
        { key: 'bad', label: 'Bad', value: Number.NaN },
        { key: '', label: 'Missing key', value: 1 },
      ])
    ).toEqual([
      {
        key: 'credits_used',
        label: 'Credits used',
        value: 1740.28,
        unit: 'credits',
        format: undefined,
        currency: undefined,
      },
      {
        key: 'charged',
        label: 'Charged',
        value: 29.61,
        unit: undefined,
        format: 'currency',
        currency: 'USD',
      },
    ]);
  });

  test('keeps buckets with the same window distinct when plugins omit bucket IDs', () => {
    const groups = buildAntigravityQuotaGroups({
      groups: [
        {
          displayName: 'Kiro credits',
          buckets: [
            { window: 'monthly', remainingFraction: 0.8 },
            { window: 'monthly', remainingFraction: 0.2 },
          ],
        },
      ],
    });

    expect(groups[0]?.buckets.map((bucket) => bucket.id)).toEqual([
      'kiro-credits-monthly-1',
      'kiro-credits-monthly-2',
    ]);
  });

  test('omits provider for probe-only quota requests', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({});
    try {
      await fetchPluginQuota(
        { name: 'kiro-a.json', supportsQuota: true, authIndex: '7' },
        ((key: string) => key) as never
      );
      expect(post.mock.calls[0]?.[0]).toBe('/quota/fetch');
      expect(post.mock.calls[0]?.[1]).toEqual({ auth_index: '7' });
    } finally {
      post.mockRestore();
    }
  });

  test('renders localized monthly quota, cost, host requests, and fallback metrics', () => {
    const markup = renderCardQuota(
      makeCardQuota([
        makeMetric('monthly_quota', 'Monthly Quota', 3000),
        makeMetric('usage_cost', 'Used This Month', 2350.04),
        makeMetric('remaining', 'Remaining', 649.96),
        makeMetric('today_cost', 'Today Cost', 6.95),
        makeMetric('week_cost', 'Last 7 Days Cost', 876.57),
        makeMetric('last_month_cost', 'Last Month', 3072.09),
        makeMetric('rate_models_active', 'Active Models', 2, 'count'),
        makeMetric('reset_day', 'Reset Day', 0, 'day'),
        makeMetric('provider_count', 'Provider count', 3, 'count'),
        makeMetric('provider_age', 'Provider age', 2, 'day'),
        makeMetric('provider_extension', 'Provider extension', 42, 'credits'),
      ])
    );

    expect(markup).toContain(i18n.t('plugin_quota.remaining_this_month'));
    expect(markup).toContain(i18n.t('plugin_quota.today_cost'));
    expect(markup).toContain('21.7%');
    expect(markup).toContain('211');
    expect(markup).toContain('Provider extension');
    expect(markup).toContain(i18n.t('plugin_quota.active_models'));
    expect(markup).toContain(`3 ${i18n.t('plugin_quota.unit_count')}`);
    expect(markup).toContain(`2 ${i18n.t('plugin_quota.unit_day')}`);
    expect(markup).toContain(i18n.t('plugin_quota.request_count_scope'));
    expect(markup).toContain(i18n.t('plugin_quota.recent_request_window'));
    expect(markup).toContain(i18n.t('plugin_quota.recent_request_window_detail'));
    expect(markup).not.toContain(i18n.t('plugin_quota.reset_day'));
    expect(markup).not.toContain('2 count');
    expect(markup).not.toContain('Available models');
    expect(markup).toContain('<details');
    expect(markup).not.toContain('Monthly Quota');
    expect(markup).not.toContain('649.96 CNY');
  });

  test('does not label a valid monthly summary as empty when no secondary metrics exist', () => {
    const markup = renderCardQuota(
      makeCardQuota([
        makeMetric('monthly_quota', 'Monthly Quota', 100),
        makeMetric('usage_cost', 'Used This Month', 25),
        makeMetric('remaining', 'Remaining', 75),
      ]),
      { ...requestSummary, counts: null }
    );
    expect(markup).toContain(i18n.t('plugin_quota.remaining_this_month'));
    expect(markup).not.toContain(i18n.t('plugin_quota.empty_data'));
  });

  test('does not invent a zero-limit percentage or hide over-quota usage', () => {
    const zero = renderCardQuota(
      makeCardQuota([
        makeMetric('monthly_quota', 'Monthly Quota', 0),
        makeMetric('usage_cost', 'Used This Month', 0),
        makeMetric('remaining', 'Remaining', 0),
      ]),
      { ...requestSummary, counts: { success: 0, failure: 0 } }
    );
    expect(zero).toContain(i18n.t('plugin_quota.progress_unavailable'));
    expect(zero).toContain(i18n.t('status_bar.no_requests'));
    expect(zero).not.toContain('<progress');
    expect(zero).not.toContain('0%');

    const over = renderCardQuota(
      makeCardQuota([
        makeMetric('monthly_quota', 'Monthly Quota', 100),
        makeMetric('usage_cost', 'Used This Month', 120),
        makeMetric('remaining', 'Remaining', -20),
      ]),
      { ...requestSummary, counts: null }
    );
    expect(over).toContain(i18n.t('plugin_quota.over_limit'));
    expect(over).toContain('120.00');
    expect(over).toContain('value="0"');
    expect(over).toContain(i18n.t('plugin_quota.remaining_percent', { percent: '0' }));
    expect(over).not.toContain('120%');
  });

  test('月额度进度条、中英文和无障碍读数均表示剩余，已用金额继续展示', async () => {
    const previousLanguage = i18n.language;
    try {
      for (const locale of ['zh-CN', 'en']) {
        await i18n.changeLanguage(locale);
        for (const [limit, used, remaining, percent, display] of [
          [3000, 2351.93, 648.07, 21.602333333333334, '21.6'],
          [100, 0, 100, 100, '100'],
          [100, 100, 0, 0, '0'],
          [100, 120, -20, 0, '0'],
        ] as const) {
          const markup = renderCardQuota(
            makeCardQuota([
              makeMetric('monthly_quota', 'Monthly Quota', limit),
              makeMetric('usage_cost', 'Used This Month', used),
              makeMetric('remaining', 'Remaining', remaining),
            ])
          );
          const progress = markup.match(/<progress[^>]*>/)?.[0] ?? '';
          const value = Number(progress.match(/value="([^"]+)"/)?.[1]);
          const label = i18n.t('plugin_quota.remaining_percent', { percent: display });
          expect(value).toBeCloseTo(percent, 8);
          expect(progress).toContain(`aria-label="${label}"`);
          expect(progress).toContain(`aria-valuetext="${label}"`);
          expect(markup).toContain(`<span>${i18n.t('plugin_quota.remaining_this_month')}</span>`);
          expect(markup).toContain(i18n.t('plugin_quota.used_this_month'));
        }
      }
    } finally {
      await i18n.changeLanguage(previousLanguage);
    }
  });

  test('provides every new plugin-card label in all configured locales', () => {
    const keys = [
      'remaining_this_month',
      'remaining_percent',
      'used_this_month',
      'today_cost',
      'week_cost',
      'last_month_cost',
      'costly_usage',
      'active_models',
      'used_percent_label',
      'reset_day',
      'details',
      'request_success_rate',
      'used_percent',
      'over_limit',
      'progress_unavailable',
      'cost_partial',
      'reset_at',
      'unit_day',
      'unit_count',
      'request_count_scope',
      'recent_request_window',
      'recent_request_window_detail',
    ];
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko']) {
      const messages = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      ) as {
        plugin_quota: Record<string, string>;
        plugin_resource: Record<string, string>;
      };
      for (const key of keys) expect(messages.plugin_quota[key]).toBeTruthy();
      expect(messages.plugin_resource.compact_confirm_title).toBeTruthy();
      expect(messages.plugin_resource.compact_confirm_message).toBeTruthy();
    }
  });
});
