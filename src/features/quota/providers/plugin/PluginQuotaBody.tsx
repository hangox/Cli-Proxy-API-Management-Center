import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import type { PluginQuotaMetric, PluginQuotaState } from '@/types';
import type { StatusBarData } from '@/utils/recentRequests';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps, QuotaClassMap } from '../../types';

export type PluginQuotaCardRequestSummary = {
  counts: { success: number; failure: number } | null;
  statusData: StatusBarData;
  statusBarStyles: Record<string, string>;
};

type MetricArea = 'quota' | 'summary' | 'details' | 'warning' | 'hidden';
const METRIC_PRESENTATION: Record<string, { area: MetricArea; labelKey?: string }> = {
  monthly_quota: { area: 'quota', labelKey: 'antigravity_quota.monthly_limit' },
  usage_cost: { area: 'quota', labelKey: 'plugin_quota.used_this_month' },
  remaining: { area: 'quota', labelKey: 'plugin_quota.remaining_this_month' },
  today_cost: { area: 'summary', labelKey: 'plugin_quota.today_cost' },
  week_cost: { area: 'summary', labelKey: 'plugin_quota.week_cost' },
  last_month_cost: { area: 'details', labelKey: 'plugin_quota.last_month_cost' },
  costly_usage: { area: 'details', labelKey: 'plugin_quota.costly_usage' },
  rate_models_active: { area: 'details', labelKey: 'plugin_quota.active_models' },
  percentage: { area: 'details', labelKey: 'plugin_quota.used_percent_label' },
  reset_day: { area: 'details', labelKey: 'plugin_quota.reset_day' },
  cost_partial: { area: 'warning' },
  availability: { area: 'hidden' },
};
const WINDOW_LABEL_KEYS: Record<string, string> = {
  monthly: 'antigravity_quota.monthly_limit',
  weekly: 'antigravity_quota.weekly_limit',
  daily: 'antigravity_quota.daily_limit',
  five_hour: 'claude_quota.five_hour',
  '5-hour': 'claude_quota.five_hour',
};
const UNIT_LABEL_KEYS: Record<string, string> = {
  day: 'plugin_quota.unit_day',
  count: 'plugin_quota.unit_count',
};

const formatMetric = (metric: PluginQuotaMetric, locale: string, t: TFunction): string => {
  const currency = metric.format === 'currency' && metric.currency;
  const value = currency
    ? new Intl.NumberFormat(locale, { style: 'currency', currency: metric.currency }).format(
        metric.value
      )
    : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(metric.value);
  const unitKey = metric.unit ? UNIT_LABEL_KEYS[metric.unit.toLowerCase()] : undefined;
  const unit =
    metric.key === 'reset_day' || metric.key === 'rate_models_active'
      ? ''
      : unitKey
        ? t(unitKey)
        : metric.unit;
  return unit && unit.toUpperCase() !== metric.currency?.toUpperCase() ? `${value} ${unit}` : value;
};
const formatReset = (value: string | undefined, locale: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(locale, { timeZoneName: 'short' });
};
const formatPercent = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);

function QuotaGroups({
  groups,
  classes,
  locale,
  translateWindow = false,
}: {
  groups: PluginQuotaState['groups'];
  classes: QuotaClassMap;
  locale: string;
  translateWindow?: boolean;
}) {
  const { t } = useTranslation();
  return groups.map((group) => {
    const window = group.buckets.length === 1 ? group.buckets[0]?.window?.toLowerCase() : '';
    const windowKey = translateWindow ? WINDOW_LABEL_KEYS[window ?? ''] : undefined;
    return (
      <div key={group.id} className={classes.antigravityQuotaGroup}>
        <div className={classes.antigravityQuotaGroupHeader}>
          <span className={classes.antigravityQuotaGroupTitle}>
            {windowKey ? t(windowKey) : group.label}
          </span>
          {group.description && (
            <span className={classes.antigravityQuotaGroupDescription}>{group.description}</span>
          )}
        </div>
        {group.buckets.map((bucket, index) => {
          const percent = Math.round(Math.max(0, Math.min(1, bucket.remainingFraction)) * 100);
          const reset = formatReset(bucket.resetTime, locale);
          return (
            <div key={bucket.id} className={classes.quotaRow}>
              <div className={classes.quotaRowHeader}>
                <span className={classes.quotaModel} title={bucket.description}>
                  {bucket.label}
                </span>
                <div className={classes.quotaMeta}>
                  <span className={classes.quotaPercent}>
                    {t('plugin_quota.remaining_percent', { percent })}
                  </span>
                  {reset && <span className={classes.quotaReset}>{reset}</span>}
                </div>
              </div>
              <QuotaMeter percent={percent} classes={classes} index={index} />
            </div>
          );
        })}
      </div>
    );
  });
}

export function PluginQuotaRequestMetric({
  requestSummary,
  cardStyles,
}: {
  requestSummary: PluginQuotaCardRequestSummary;
  cardStyles: Record<string, string>;
}) {
  const { t, i18n } = useTranslation();
  const { counts, statusData, statusBarStyles } = requestSummary;
  const total = counts ? counts.success + counts.failure : null;
  const rate = counts && total ? (counts.success / total) * 100 : null;
  const number = new Intl.NumberFormat(i18n.language);
  const note =
    counts === null
      ? '—'
      : total === 0
        ? `${t('stats.success')} 0 · ${t('stats.failure')} 0 · ${t('status_bar.no_requests')}`
        : `${t('stats.success')} ${number.format(counts.success)} · ${t('stats.failure')} ${number.format(counts.failure)}`;
  return (
    <div className={cardStyles.pluginQuotaRequestMetric}>
      <dt
        title={t('plugin_quota.request_count_scope')}
        aria-label={`${t('plugin_quota.request_success_rate')}. ${t('plugin_quota.request_count_scope')}`}
      >
        {t('plugin_quota.request_success_rate')}
      </dt>
      <dd>{rate === null ? '—' : `${formatPercent(rate, i18n.language)}%`}</dd>
      <div className={cardStyles.pluginQuotaMetricNote}>{note}</div>
      <div
        className={cardStyles.pluginQuotaMetricNote}
        title={t('plugin_quota.recent_request_window_detail')}
        aria-label={t('plugin_quota.recent_request_window_detail')}
      >
        {t('plugin_quota.recent_request_window')}
      </div>
      <div
        className={cardStyles.pluginQuotaRequestBar}
        role="group"
        aria-label={t('plugin_quota.recent_request_window_detail')}
      >
        <ProviderStatusBar
          statusData={statusData}
          styles={{ ...statusBarStyles, statusRate: cardStyles.pluginQuotaRequestRateHidden }}
        />
      </div>
    </div>
  );
}

function PluginQuotaCard({
  quota,
  classes,
  cardStyles,
  requestSummary,
}: QuotaBodyProps<PluginQuotaState> & {
  cardStyles: Record<string, string>;
  requestSummary: PluginQuotaCardRequestSummary;
}) {
  const { t, i18n } = useTranslation();
  const metric = (key: string) => quota.summary.find((item) => item.key === key);
  const limit = metric('monthly_quota');
  const used = metric('usage_cost');
  const remaining = metric('remaining');
  const monthlyBucket = quota.groups
    .flatMap((group) => group.buckets)
    .find((item) => item.window === 'monthly');
  const remainingValue = remaining?.value ?? (limit && used ? limit.value - used.value : null);
  const hasHero = Boolean((limit || monthlyBucket) && (remaining || (limit && used)));
  const hasProgress = Boolean(limit && used && limit.value > 0);
  const percentRemaining = hasProgress
    ? Math.min(100, Math.max(0, (remainingValue! / limit!.value) * 100))
    : null;
  const overLimit =
    Boolean(remainingValue !== null && remainingValue < 0) ||
    Boolean(limit && used && used.value > limit.value);
  const area = (item: PluginQuotaMetric): MetricArea => {
    const value = METRIC_PRESENTATION[item.key]?.area ?? 'details';
    if (value === 'hidden' || value === 'warning' || (value === 'quota' && hasHero))
      return 'hidden';
    return item.key === 'percentage' && hasProgress ? 'hidden' : value;
  };
  const label = (item: PluginQuotaMetric) => {
    const key = METRIC_PRESENTATION[item.key]?.labelKey;
    return key ? t(key) : item.label;
  };
  const summary = quota.summary.filter((item) => area(item) === 'summary');
  const details = quota.summary.filter(
    (item) => area(item) === 'details' && !(item.key === 'reset_day' && item.value <= 0)
  );
  const hasData =
    hasHero ||
    quota.groups.some((group) => group.buckets.length > 0) ||
    summary.length > 0 ||
    details.length > 0;
  const plan =
    quota.subscription?.tierName || quota.subscription?.plan || quota.subscription?.tierId;
  const partialCost = (metric('cost_partial')?.value ?? 0) > 0;
  const resetAt = formatReset(monthlyBucket?.resetTime, i18n.language);
  const remainingLabel =
    percentRemaining === null
      ? ''
      : t('plugin_quota.remaining_percent', {
          percent: formatPercent(percentRemaining, i18n.language),
        });
  const amount = remaining ?? limit ?? used;

  return (
    <>
      {plan && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanLabel}>{t('plugin_quota.plan_label')}</span>
          <span className={classes.codexPlanValue}>{plan}</span>
        </div>
      )}
      {hasHero && amount && remainingValue !== null && (
        <section
          className={cardStyles.pluginQuotaHero}
          aria-label={t('plugin_quota.remaining_this_month')}
        >
          <div className={cardStyles.pluginQuotaHeroHead}>
            <div>
              <div className={cardStyles.pluginQuotaHeroLabel}>
                {t('plugin_quota.remaining_this_month')}
              </div>
              <div className={cardStyles.pluginQuotaHeroValue}>
                {formatMetric({ ...amount, value: remainingValue }, i18n.language, t)}
              </div>
            </div>
            {overLimit && (
              <span className={cardStyles.pluginQuotaOverLimit} role="status">
                {t('plugin_quota.over_limit')}
              </span>
            )}
          </div>
          {(used || limit) && (
            <div className={cardStyles.pluginQuotaBreakdown}>
              {used && (
                <span>
                  {t('plugin_quota.used_this_month')} {formatMetric(used, i18n.language, t)}
                </span>
              )}
              {limit && (
                <span>
                  {t('antigravity_quota.monthly_limit')} {formatMetric(limit, i18n.language, t)}
                </span>
              )}
            </div>
          )}
          {percentRemaining !== null && (
            <>
              <div className={cardStyles.pluginQuotaProgressLabel}>
                <span>{t('plugin_quota.remaining_this_month')}</span>
                <span>{remainingLabel}</span>
              </div>
              <progress
                value={percentRemaining}
                max={100}
                aria-label={remainingLabel}
                aria-valuetext={remainingLabel}
              />
            </>
          )}
          {limit?.value === 0 && (
            <div className={cardStyles.pluginQuotaMetricNote}>
              {t('plugin_quota.progress_unavailable')}
            </div>
          )}
          {resetAt && (
            <div className={classes.quotaReset}>
              <span>{t('plugin_quota.reset_at')}</span>
              <time dateTime={monthlyBucket?.resetTime}>{resetAt}</time>
            </div>
          )}
        </section>
      )}
      {!hasData && <div className={classes.quotaMessage}>{t('plugin_quota.empty_data')}</div>}
      {partialCost && (
        <div className={cardStyles.pluginQuotaMetricNote} role="status">
          {t('plugin_quota.cost_partial')}
        </div>
      )}
      {(summary.length > 0 || requestSummary) && (
        <dl className={cardStyles.pluginQuotaMetrics}>
          {summary.map((item) => (
            <div key={item.key}>
              <dt>{label(item)}</dt>
              <dd>{formatMetric(item, i18n.language, t)}</dd>
            </div>
          ))}
          <PluginQuotaRequestMetric requestSummary={requestSummary} cardStyles={cardStyles} />
        </dl>
      )}
      {(details.length > 0 || quota.groups.length > 0) && (
        <details className={cardStyles.pluginQuotaDetails}>
          <summary>{t('plugin_quota.details')}</summary>
          {details.length > 0 && (
            <dl>
              {details.map((item) => (
                <div key={item.key}>
                  <dt>{label(item)}</dt>
                  <dd>{formatMetric(item, i18n.language, t)}</dd>
                </div>
              ))}
            </dl>
          )}
          <QuotaGroups
            groups={quota.groups}
            classes={classes}
            locale={i18n.language}
            translateWindow
          />
        </details>
      )}
    </>
  );
}

export function PluginQuotaBody({
  quota,
  classes,
  cardStyles,
  requestSummary,
}: QuotaBodyProps<PluginQuotaState> & {
  cardStyles?: Record<string, string>;
  requestSummary?: PluginQuotaCardRequestSummary;
}) {
  const { t, i18n } = useTranslation();
  const plan =
    quota.subscription?.tierName || quota.subscription?.plan || quota.subscription?.tierId;
  if (cardStyles && requestSummary)
    return (
      <PluginQuotaCard
        quota={quota}
        classes={classes}
        cardStyles={cardStyles}
        requestSummary={requestSummary}
      />
    );
  return (
    <>
      {(plan || quota.summary.length > 0) && (
        <div className={classes.codexPlan}>
          {plan && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('plugin_quota.plan_label')}</span>
              <span className={classes.codexPlanValue}>{plan}</span>
            </span>
          )}
          {quota.summary.map((item) => (
            <span key={item.key} className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{item.label}</span>
              <span className={classes.codexPlanValue}>{formatMetric(item, i18n.language, t)}</span>
            </span>
          ))}
        </div>
      )}
      {!plan && quota.summary.length === 0 && quota.groups.length === 0 ? (
        <div className={classes.quotaMessage}>{t('plugin_quota.empty_data')}</div>
      ) : (
        <QuotaGroups groups={quota.groups} classes={classes} locale={i18n.language} />
      )}
    </>
  );
}
