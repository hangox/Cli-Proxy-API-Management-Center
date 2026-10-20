import { describe, expect, test } from 'bun:test';
import {
  resolveAntigravityBucketLabelKey,
  resolveAntigravityGroupLabelKey,
  resolveAntigravityGroupModels,
  shouldShowAntigravityQuotaAvailable,
  resolveAntigravityBucketDisplay,
} from '@/features/quota/providers/antigravity/labels';
import {
  ANTIGRAVITY_USER_AGENT,
  ANTIGRAVITY_HUB_VERSION,
  ANTIGRAVITY_HUB_PLATFORM,
  buildAntigravityUserAgent,
} from '@/utils/quota/constants';
import { buildAntigravityQuotaGroups } from '@/utils/quota/builders';

describe('Antigravity User-Agent (91b4785)', () => {
  test('formats UA as antigravity/hub/version platform', () => {
    expect(ANTIGRAVITY_HUB_VERSION).toBe('2.23.0');
    expect(ANTIGRAVITY_HUB_PLATFORM).toBe('darwin/arm64');
    expect(ANTIGRAVITY_USER_AGENT).toBe('antigravity/hub/2.23.0 darwin/arm64');
    expect(buildAntigravityUserAgent({ version: '3.0.0', platform: 'linux/amd64' })).toBe(
      'antigravity/hub/3.0.0 linux/amd64'
    );
  });
});

describe('Antigravity quota label keys (27547a4)', () => {
  test('matches group names case-insensitively', () => {
    expect(resolveAntigravityGroupLabelKey('Gemini Models')).toBe('group_gemini_models');
    expect(resolveAntigravityGroupLabelKey(' Claude and  GPT models ')).toBe(
      'group_claude_gpt_models'
    );
    expect(resolveAntigravityGroupLabelKey('Image Models')).toBeNull();
  });

  test('appends Gemini Argon to the Gemini group model list (c59ab41)', () => {
    expect(
      resolveAntigravityGroupModels(
        'Gemini Models',
        'Models within this group: Gemini Flash, Gemini Pro'
      )
    ).toEqual(['Gemini Flash', 'Gemini Pro', 'Gemini Argon']);
    expect(
      resolveAntigravityGroupModels(
        'Gemini Models',
        'Models within this group: Gemini Flash, gemini argon'
      )
    ).toEqual(['Gemini Flash', 'gemini argon']);
  });

  test('leaves other groups and non-list descriptions untouched', () => {
    expect(
      resolveAntigravityGroupModels(
        'Claude and GPT models',
        'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS'
      )
    ).toEqual(['Claude Opus', 'Claude Sonnet', 'GPT-OSS']);
    expect(resolveAntigravityGroupModels('Gemini Models', 'Shared Gemini quota')).toBeNull();
    expect(resolveAntigravityGroupModels('Gemini Models', undefined)).toBeNull();
  });

  test('ignores the upstream "Remaining" suffix on bucket names', () => {
    expect(resolveAntigravityBucketLabelKey('Five Hour Limit Remaining', '5h')).toBe(
      'five_hour_limit'
    );
    expect(resolveAntigravityBucketLabelKey('Weekly Limit Remaining', 'weekly')).toBe(
      'weekly_limit'
    );
    expect(resolveAntigravityBucketLabelKey('5-hour limit', undefined)).toBe('five_hour_limit');
    expect(resolveAntigravityBucketLabelKey('Weekly Limit', undefined)).toBe('weekly_limit');
  });

  test('falls back to the structured window for unknown bucket names', () => {
    expect(resolveAntigravityBucketLabelKey('Rolling quota', '5h')).toBe('five_hour_limit');
    expect(resolveAntigravityBucketLabelKey('Rolling quota', 'Weekly')).toBe('weekly_limit');
    expect(resolveAntigravityBucketLabelKey('Rolling quota', 'hourly')).toBeNull();
    expect(resolveAntigravityBucketLabelKey('Rolling quota', undefined)).toBeNull();
  });

  test('resolves every group and bucket from the current upstream payload', () => {
    const bucket = (id: string, name: string, window: string) => ({
      bucketId: id,
      displayName: name,
      window,
      resetTime: '2026-10-23T02:43:12Z',
      remainingFraction: 1,
    });
    const groups = buildAntigravityQuotaGroups({
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            bucket('gemini-weekly', 'Weekly Limit Remaining', 'weekly'),
            bucket('gemini-5h', 'Five Hour Limit Remaining', '5h'),
          ],
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            bucket('3p-weekly', 'Weekly Limit Remaining', 'weekly'),
            bucket('3p-5h', 'Five Hour Limit Remaining', '5h'),
          ],
        },
      ],
    });

    expect(groups.map((group) => resolveAntigravityGroupLabelKey(group.label))).toEqual([
      'group_gemini_models',
      'group_claude_gpt_models',
    ]);
    expect(
      groups.flatMap((group) =>
        group.buckets.map((b) => resolveAntigravityBucketLabelKey(b.label, b.window))
      )
    ).toEqual(['five_hour_limit', 'weekly_limit', 'five_hour_limit', 'weekly_limit']);
  });
});

describe('Antigravity bucket display semantics (fe29633 + contract)', () => {
  const mockT = (key: string, options?: Record<string, unknown>) => {
    if (key === 'antigravity_quota.remaining_percent') {
      return `剩余 ${options?.percent}%`;
    }
    if (key === 'antigravity_quota.quota_available') {
      return '额度可用';
    }
    return key;
  };

  test('renders "额度可用" with percent=100 for unconsumed full quota', () => {
    const bucket5h = {
      label: 'Five Hour Limit Remaining',
      window: '5h',
      remainingFraction: 1,
    };
    const bucketWeekly = {
      label: 'Weekly Limit Remaining',
      window: 'weekly',
      remainingFraction: 1,
    };
    const all = [bucket5h, bucketWeekly];

    expect(shouldShowAntigravityQuotaAvailable(bucket5h, all)).toBe(true);
    expect(shouldShowAntigravityQuotaAvailable(bucketWeekly, all)).toBe(true);

    const res5h = resolveAntigravityBucketDisplay(bucket5h, all, mockT);
    expect(res5h.percent).toBe(100);
    expect(res5h.percentLabel).toBe('额度可用');

    const resWeekly = resolveAntigravityBucketDisplay(bucketWeekly, all, mockT);
    expect(resWeekly.percent).toBe(100);
    expect(resWeekly.percentLabel).toBe('额度可用');
  });

  test('renders real numeric percentage when partially used', () => {
    const bucket = {
      label: '5-hour limit',
      window: '5h',
      remainingFraction: 0.8047521,
    };
    const res = resolveAntigravityBucketDisplay(bucket, [bucket], mockT);
    expect(res.percent).toBe(80);
    expect(res.percentLabel).toBe('剩余 80%');
  });

  test('downgrades 5h limit to 0% when weekly limit is exhausted (fe29633)', () => {
    const bucket5h = {
      label: 'Five Hour Limit Remaining',
      window: '5h',
      remainingFraction: 1, // Upstream still reports 1 even when blocked
    };
    const bucketWeekly = {
      label: 'Weekly Limit Remaining',
      window: 'weekly',
      remainingFraction: 0, // Weekly exhausted
    };
    const all = [bucket5h, bucketWeekly];

    expect(shouldShowAntigravityQuotaAvailable(bucket5h, all)).toBe(false);

    const res5h = resolveAntigravityBucketDisplay(bucket5h, all, mockT);
    // Must NOT show '额度可用' or fake 100% when weekly is exhausted
    expect(res5h.percent).toBe(0);
    expect(res5h.percentLabel).toBe('剩余 0%');
  });

  test('does not forge 100% progress bar when fraction is null or boolean available', () => {
    const bucket = {
      label: 'Five Hour Limit Remaining',
      window: '5h',
      remainingFraction: null,
    };
    const res = resolveAntigravityBucketDisplay(bucket, [bucket], mockT);
    // When no numeric fraction, percent MUST be null so QuotaMeter renders empty track
    expect(res.percent).toBeNull();
    expect(res.percentLabel).toBe('额度可用');
  });
});
