/**
 * Provider bodies rendered end-to-end.
 *
 * Bodies receive their class map as a prop and import no stylesheet, so unlike
 * QuotaCard they can be rendered directly here — which is the only place the
 * "absolute plus countdown" pairing is checked as actual markup rather than as
 * a formatter's return value.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { KimiQuotaBody } from '@/features/quota/providers/kimi/KimiQuotaBody';
import { AntigravityQuotaBody } from '@/features/quota/providers/antigravity/AntigravityQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { formatInstantShort } from '@/utils/quota';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import type { AntigravityQuotaState, ClaudeQuotaState, CodexQuotaState, KimiQuotaState } from '@/types';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);

/**
 * useNow() freezes to module-load time under renderToStaticMarkup (it reads
 * getServerSnapshot), so instants are placed relative to the real clock.
 */
const now = Date.now();

// The i18n fallback is zh-CN; pin English so the countdown assertions read.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('CodexQuotaBody', () => {
  const quota: CodexQuotaState = {
    status: 'success',
    planType: 'pro',
    windows: [
      {
        id: 'primary',
        label: '5-hour limit',
        usedPercent: 38,
        resetLabel: '08-02 18:00',
        resetAtMs: now + 3 * HOUR_MS,
        periodHours: 5,
      },
    ],
    rateLimitResetCredits: [
      {
        id: 'credit-1',
        status: 'available',
        grantedAt: new Date(now - DAY_MS).toISOString(),
        expiresAt: new Date(now + 11 * DAY_MS).toISOString(),
      },
    ],
    rateLimitResetCreditsAvailableCount: 1,
  };

  test.each(['en', 'zh-CN', 'zh-TW', 'ru'])(
    'renders Business Premium with its premium badge in %s',
    async (language) => {
      await i18n.changeLanguage(language);
      try {
        for (const planType of ['self_serve_business_prolite', '  SELF_SERVE_BUSINESS_PROLITE  ']) {
          const markup = renderToStaticMarkup(
            createElement(CodexQuotaBody, { quota: { ...quota, planType }, classes })
          );
          expect(markup).toContain('<span class="premiumPlanValue">Business Premium</span>');
          expect(markup).not.toContain('self_serve_business_prolite');
        }
      } finally {
        await i18n.changeLanguage('en');
      }
    }
  );

  test.each([
    ['pro', 'Pro 200', 'elitePlanValue'],
    ['prolite', 'Pro 100', 'premiumPlanValue'],
    ['team', 'Team', 'codexPlanValue'],
    ['self_serve_business_usage_based', 'self_serve_business_usage_based', 'codexPlanValue'],
  ])('preserves the label and badge for %s', (planType, label, className) => {
    const markup = renderToStaticMarkup(
      createElement(CodexQuotaBody, { quota: { ...quota, planType }, classes })
    );
    expect(markup).toContain(`<span class="${className}">${label}</span>`);
  });

  test.each([
    ['en', 'Credit balance', 'Unlimited'],
    ['zh-CN', 'Credit 余额', '无限额'],
    ['zh-TW', 'Credit 餘額', '無限額'],
    ['ru', 'Остаток кредитов', 'Без ограничений'],
  ])(
    'renders account credits independently of manual resets in %s',
    async (language, label, unlimited) => {
      await i18n.changeLanguage(language);
      try {
        const balance = renderToStaticMarkup(
          createElement(CodexQuotaBody, { quota: { ...quota, creditBalance: '0' }, classes })
        );
        expect(balance).toContain(label);
        expect(balance).toContain('<span class="codexPlanValue">0</span>');
        const infinite = renderToStaticMarkup(
          createElement(CodexQuotaBody, {
            quota: { ...quota, creditBalance: null, creditsUnlimited: true },
            classes,
          })
        );
        expect(infinite).toContain(label);
        expect(infinite).toContain(unlimited);
        const absent = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));
        expect(absent).not.toContain(label);
      } finally {
        await i18n.changeLanguage('en');
      }
    }
  );

  test('renders a window reset as absolute plus countdown', () => {
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));

    expect(markup).toContain('08-02 18:00');
    expect(markup).toContain('quotaResetRelative');
    expect(markup).toMatch(/3 hours/);
  });

  test('renders reset-credit expiry in local time with a countdown', () => {
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));

    expect(markup).toContain(formatInstantShort(now + 11 * DAY_MS));
    expect(markup).toMatch(/11 days/);
  });

  test('highlights a credit expiring within the final hour', () => {
    const creditFirst: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: now + 5 * DAY_MS }],
      rateLimitResetCredits: [
        {
          id: 'credit-1',
          status: 'available',
          grantedAt: new Date(now - DAY_MS).toISOString(),
          expiresAt: new Date(now + 30 * 60_000).toISOString(),
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(CodexQuotaBody, { quota: creditFirst, classes })
    );

    expect(markup).toContain('codexResetCreditRowSoon');
    expect(markup).not.toContain('quotaRowSoon');
  });

  test('does not emphasize a reset countdown more than one hour away', () => {
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));

    expect(markup).not.toContain('quotaRowSoon');
    expect(markup).not.toContain('quotaResetRelativeSoon');
    expect(markup).not.toContain('codexResetCreditRowSoon');
  });

  test('emphasizes a reset countdown within the final hour', () => {
    const urgent: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: now + 30 * 60_000 }],
    };
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota: urgent, classes }));

    expect(markup).toContain('quotaResetRelativeSoon');
  });

  test('highlights nothing once every instant is in the past', () => {
    const stale: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: now - HOUR_MS }],
      rateLimitResetCredits: [],
      rateLimitResetCreditsAvailableCount: null,
    };
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota: stale, classes }));

    expect(markup).not.toContain('Soon');
  });

  test('keeps the baked label alone when the store entry predates resetAtMs', () => {
    const stale: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: undefined, periodHours: undefined }],
      rateLimitResetCredits: [],
      rateLimitResetCreditsAvailableCount: null,
    };
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota: stale, classes }));

    expect(markup).toContain('08-02 18:00');
    expect(markup).not.toContain('quotaResetRelative');
  });
});

describe('KimiQuotaBody', () => {
  test('renders the concrete reset time alongside its countdown', () => {
    const resetAtMs = now + 3 * HOUR_MS;
    const quota: KimiQuotaState = {
      status: 'success',
      rows: [
        {
          id: 'summary',
          label: 'Weekly limit',
          used: 34,
          limit: 100,
          resetHint: '3h',
          resetAtMs,
          periodHours: 168,
        },
      ],
    };
    const markup = renderToStaticMarkup(createElement(KimiQuotaBody, { quota, classes }));

    expect(markup).toContain(formatInstantShort(resetAtMs));
    expect(markup).toContain('quotaResetRelative');
    expect(markup).toMatch(/3 hours/);
    expect(markup).not.toContain('resets in 3h');
  });
});

describe('ClaudeQuotaBody', () => {
  test('pairs each window reset with a countdown', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [
        {
          id: 'five_hour',
          label: '5-hour',
          usedPercent: 12,
          resetLabel: '08-02 17:00',
          resetAtMs: now + 2 * HOUR_MS,
          periodHours: 5,
        },
        {
          id: 'seven_day',
          label: '7-day',
          usedPercent: 60,
          resetLabel: '08-06 04:00',
          resetAtMs: now + 4 * DAY_MS,
          periodHours: 168,
        },
      ],
    };
    const markup = renderToStaticMarkup(createElement(ClaudeQuotaBody, { quota, classes }));

    expect(markup).toContain('08-02 17:00');
    expect(markup).toContain('08-06 04:00');
    expect(markup).toMatch(/2 hours/);
    expect(markup).toMatch(/4 days/);
  });
});

describe('AntigravityQuotaBody', () => {
  const quota: AntigravityQuotaState = {
    status: 'success',
    subscription: {
      plan: 'pro',
      tierName: null,
      tierId: null,
    },
    groups: [
      {
        id: 'claude-and-gpt-models',
        label: 'Claude and GPT models',
        buckets: [
          {
            id: '3p-5h',
            label: 'Five Hour Limit Remaining',
            window: '5h',
            remainingFraction: 1,
            resetTime: new Date(now + 2 * HOUR_MS).toISOString(),
          },
          {
            id: '3p-weekly',
            label: 'Weekly Limit Remaining',
            window: 'weekly',
            remainingFraction: 1,
            resetTime: new Date(now + 5 * DAY_MS).toISOString(),
          },
        ],
      },
    ],
  };

  test('renders localized bucket labels and official available state for unconsumed quota', async () => {
    await i18n.changeLanguage('zh-CN');
    try {
      const markup = renderToStaticMarkup(createElement(AntigravityQuotaBody, { quota, classes }));
      expect(markup).toContain('5 小时限额');
      expect(markup).toContain('周限额');
      expect(markup).toContain('额度可用');
      expect(markup).not.toContain('Five Hour Limit Remaining');
      expect(markup).not.toContain('Weekly Limit Remaining');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  test('renders real numeric percentage when quota is partially consumed', async () => {
    await i18n.changeLanguage('zh-CN');
    try {
      const consumedQuota: AntigravityQuotaState = {
        ...quota,
        groups: [
          {
            ...quota.groups[0],
            buckets: [
              { ...quota.groups[0].buckets[0], remainingFraction: 0.8047521 },
            ],
          },
        ],
      };
      const markup = renderToStaticMarkup(createElement(AntigravityQuotaBody, { quota: consumedQuota, classes }));
      expect(markup).toContain('剩余 80%');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  test('prevents forging 100% or false available when weekly limit is exhausted', async () => {
    await i18n.changeLanguage('zh-CN');
    try {
      const blockedQuota: AntigravityQuotaState = {
        ...quota,
        groups: [
          {
            ...quota.groups[0],
            buckets: [
              { ...quota.groups[0].buckets[0], remainingFraction: 1 },
              { ...quota.groups[0].buckets[1], remainingFraction: 0 },
            ],
          },
        ],
      };
      const markup = renderToStaticMarkup(
        createElement(AntigravityQuotaBody, { quota: blockedQuota, classes })
      );
      expect(markup).toContain('剩余 0%');
      expect(markup).not.toContain('额度可用');
      expect(markup).not.toContain('剩余 100%');
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

