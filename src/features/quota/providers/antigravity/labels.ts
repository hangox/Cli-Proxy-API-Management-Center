/**
 * Antigravity 额度标签、模型补全与语义解析（纯函数，便于单测与跨端复用）。
 *
 * 1. 上游 displayName 随版本变化（如 "Five Hour Limit Remaining"），
 *    先归一化并剥离 "Remaining" 后缀，匹配不到再回落到结构化 window 字段。
 * 2. 模型列表补全：上游未列出但实际共享该分组额度的模型（如 Gemini Argon），追加至分组描述。
 * 3. 额度语义与进度条契约（不可伪造 100%，杜绝周限额耗尽时的假可用误报）：
 *    - 依赖阻断：同组周限额已耗尽（<= 0）时，5 小时限额即使上游静态返回 1 也实际不可用，降级为 0%，绝对不可误报“额度可用”或 100%；
 *    - 满额未消耗（=== 1 且未被周限额阻断）：对齐 Google 官方 agy CLI，展示“额度可用”，percent=100；
 *    - 消耗后（< 1）：展示真实数值百分比“剩余 X%”；
 *    - 纯布尔/无数值可用态：percent 为 null（空轨道，不伪造满绿条），文字显示“额度可用”。
 */

const GROUP_LABEL_KEYS = new Map<string, string>([
  ['gemini models', 'group_gemini_models'],
  ['claude and gpt models', 'group_claude_gpt_models'],
]);

const BUCKET_LABEL_KEYS = new Map<string, string>([
  ['weekly limit', 'weekly_limit'],
  ['daily limit', 'daily_limit'],
  ['5 hour limit', 'five_hour_limit'],
  ['5-hour limit', 'five_hour_limit'],
  ['five hour limit', 'five_hour_limit'],
  ['five-hour limit', 'five_hour_limit'],
  ['monthly limit', 'monthly_limit'],
]);

const BUCKET_WINDOW_KEYS = new Map<string, string>([
  ['5h', 'five_hour_limit'],
  ['five-hour', 'five_hour_limit'],
  ['five_hour', 'five_hour_limit'],
  ['daily', 'daily_limit'],
  ['day', 'daily_limit'],
  ['weekly', 'weekly_limit'],
  ['week', 'weekly_limit'],
  ['monthly', 'monthly_limit'],
  ['month', 'monthly_limit'],
]);

/**
 * 上游分组描述未列出、但实际共享该分组额度的模型，追加到「此分组包含」列表末尾。
 */
const GROUP_EXTRA_MODELS = new Map<string, readonly string[]>([
  ['group_gemini_models', ['Gemini Argon']],
]);

const GROUP_MODELS_PATTERN = /^models within this group:\s*(.+)$/i;

const normalizeText = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** 去掉上游常见的 "Remaining" 后缀，如 "Weekly Limit Remaining" → "weekly limit"。 */
const stripRemainingSuffix = (value: string): string =>
  value.replace(/\s*(?:-|:)?\s*remaining$/, '').trim();

export function resolveAntigravityGroupLabelKey(label: string): string | null {
  return GROUP_LABEL_KEYS.get(normalizeText(label)) ?? null;
}

/**
 * 解析分组描述中的模型列表，并追加该分组的补充模型（大小写不敏感去重）。
 * 描述不是「Models within this group: ...」格式时返回 null，由调用方显示原文。
 */
export function resolveAntigravityGroupModels(
  label: string,
  description: string | undefined
): string[] | null {
  const match = description?.trim().match(GROUP_MODELS_PATTERN);
  if (!match) return null;

  const models = match[1]
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const groupKey = resolveAntigravityGroupLabelKey(label);
  const extras = groupKey ? (GROUP_EXTRA_MODELS.get(groupKey) ?? []) : [];
  const seen = new Set(models.map(normalizeText));
  extras.forEach((model) => {
    if (seen.has(normalizeText(model))) return;
    seen.add(normalizeText(model));
    models.push(model);
  });
  return models;
}

export function resolveAntigravityBucketLabelKey(
  label: string,
  window: string | undefined
): string | null {
  const normalized = normalizeText(label);
  const byLabel =
    BUCKET_LABEL_KEYS.get(normalized) ?? BUCKET_LABEL_KEYS.get(stripRemainingSuffix(normalized));
  if (byLabel) return byLabel;
  if (!window) return null;
  return BUCKET_WINDOW_KEYS.get(normalizeText(window)) ?? null;
}

export interface AntigravityBucketLike {
  label: string;
  window?: string;
  remainingFraction?: number | null;
}

/**
 * 满额桶是否显示「额度可用」（对齐 fe29633）。同组周限额已耗尽时，5 小时限额即使满额也不可用
 * （上游会把它标为 disabled 且 remainingFraction 仍为 1），此时不显示「额度可用」。
 */
export function shouldShowAntigravityQuotaAvailable(
  bucket: AntigravityBucketLike,
  groupBuckets: readonly AntigravityBucketLike[]
): boolean {
  if (bucket.remainingFraction !== 1) return false;
  if (resolveAntigravityBucketLabelKey(bucket.label, bucket.window) !== 'five_hour_limit') {
    return true;
  }
  return !groupBuckets.some(
    (item) =>
      resolveAntigravityBucketLabelKey(item.label, item.window) === 'weekly_limit' &&
      typeof item.remainingFraction === 'number' &&
      item.remainingFraction <= 0
  );
}

export interface AntigravityBucketDisplayResult {
  percent: number | null;
  percentLabel: string;
}

export function resolveAntigravityBucketDisplay(
  bucket: AntigravityBucketLike,
  groupBuckets: readonly AntigravityBucketLike[],
  t: (key: string, options?: Record<string, unknown>) => string
): AntigravityBucketDisplayResult {
  // 1. 无数值（纯布尔/缺失）：percent = null，严禁把“可用”映射为 100% 满绿条
  if (
    bucket.remainingFraction === null ||
    bucket.remainingFraction === undefined ||
    typeof bucket.remainingFraction !== 'number' ||
    Number.isNaN(bucket.remainingFraction)
  ) {
    return {
      percent: null,
      percentLabel: t('antigravity_quota.quota_available'),
    };
  }

  // 2. 依赖阻断：同组周限额已耗尽时，5 小时限额即使上游标 1 也实际不可用，绝对不可误报 100% 或可用
  const bucketKey = resolveAntigravityBucketLabelKey(bucket.label, bucket.window);
  if (bucketKey === 'five_hour_limit') {
    const weeklyBucket = groupBuckets.find(
      (item) => resolveAntigravityBucketLabelKey(item.label, item.window) === 'weekly_limit'
    );
    if (
      weeklyBucket &&
      typeof weeklyBucket.remainingFraction === 'number' &&
      weeklyBucket.remainingFraction <= 0
    ) {
      return {
        percent: 0,
        percentLabel: t('antigravity_quota.remaining_percent', { percent: 0 }),
      };
    }
  }

  // 3. 满额可用态特判（对齐 agy 官方设计）：未消耗满额时显示“额度可用”，percent=100
  if (shouldShowAntigravityQuotaAvailable(bucket, groupBuckets)) {
    return {
      percent: 100,
      percentLabel: t('antigravity_quota.quota_available'),
    };
  }

  // 4. 消耗后（< 1）：如实展示“剩余 X%”
  const clamped = Math.max(0, Math.min(1, bucket.remainingFraction));
  const percent = Math.round(clamped * 100);
  return {
    percent,
    percentLabel: t('antigravity_quota.remaining_percent', { percent }),
  };
}
