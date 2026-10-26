import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import en from '@/i18n/locales/en.json';
import { OAuthFlowDialog } from '@/features/oauth/components/OAuthFlowDialog';
import {
  isAutoDetectPluginProvider,
  OAUTH_PROVIDERS,
  PLUGIN_PROVIDERS_WITHOUT_CALLBACK,
  supportsManualCallback,
  type OAuthProviderCard,
} from '@/features/oauth/providers';
import type { ProviderFlowState } from '@/features/oauth/hooks/useOAuthFlows';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });

const pluginCard = (id: string): OAuthProviderCard => ({
  kind: 'plugin',
  id,
  title: id,
  icon: '',
});

const builtinCard = (id: string): OAuthProviderCard => {
  const card = OAUTH_PROVIDERS.find((provider) => provider.id === id);
  if (!card) throw new Error(`未知内置提供商: ${id}`);
  return card;
};

/** 与 OAuthPage 使用相同的 supportsCallback / autoDetect 判定渲染弹窗。 */
const renderDialog = (
  card: OAuthProviderCard,
  state: ProviderFlowState = { status: 'waiting', url: 'https://provider.example/auth' }
) => {
  const prefix = card.kind === 'plugin' ? 'plugin' : card.id.replace('-', '_');
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(OAuthFlowDialog, {
        open: true,
        providerId: card.id,
        heading: { title: `${card.id} OAuth`, caption: 'Login', icon: '' },
        state,
        text: (suffix: string) =>
          card.kind === 'plugin'
            ? i18n.t(`auth_login.plugin_${suffix}`, { name: card.id })
            : i18n.t(`auth_login.${prefix}_${suffix}`),
        supportsCallback: supportsManualCallback(card),
        autoDetect: isAutoDetectPluginProvider(card),
        onStart: () => {},
        onCancel: () => {},
        onCallbackChange: () => {},
        onCallbackSubmit: () => {},
        onViewAuthFiles: () => {},
        onClose: () => {},
      })
    )
  );
};

/** 步骤数：每个 <li> 即一个步骤。 */
const countSteps = (markup: string) => markup.match(/<li[\s>]/g)?.length ?? 0;

describe('plugin OAuth callback visibility', () => {
  test('CodeMaker (cmh) plugin takes no manual callback while other plugins still do', () => {
    expect(PLUGIN_PROVIDERS_WITHOUT_CALLBACK.has('cmh')).toBe(true);
    expect(supportsManualCallback(pluginCard('cmh'))).toBe(false);
    expect(supportsManualCallback(pluginCard('some-plugin'))).toBe(true);
  });

  test('built-in callback support is unchanged', () => {
    const supported = OAUTH_PROVIDERS.filter(supportsManualCallback)
      .map((provider) => provider.id)
      .sort();
    expect(supported).toEqual(['anthropic', 'antigravity', 'codex', 'devin', 'xai']);
  });

  test('isAutoDetectPluginProvider only matches listed plugin providers', () => {
    expect(isAutoDetectPluginProvider(pluginCard('cmh'))).toBe(true);
    expect(isAutoDetectPluginProvider(pluginCard('some-plugin'))).toBe(false);
    for (const card of OAUTH_PROVIDERS) {
      expect(isAutoDetectPluginProvider(card)).toBe(false);
    }
  });

  test('dialog hides the callback input for CodeMaker and keeps it for other plugins', () => {
    const cmhMarkup = renderDialog(pluginCard('cmh'));
    expect(cmhMarkup).not.toContain('<input');
    expect(cmhMarkup).not.toContain(en.auth_login.oauth_callback_button);
    expect(cmhMarkup).not.toContain(en.auth_login.oauth_callback_label);
    expect(cmhMarkup).toContain(en.auth_login.oauth_auto_detect_label);
    expect(cmhMarkup).toContain(en.auth_login.oauth_auto_detect_hint);
    expect(cmhMarkup).not.toContain('auth_login.');

    const otherMarkup = renderDialog(pluginCard('some-plugin'));
    expect(otherMarkup).toContain('<input');
    expect(otherMarkup).toContain(en.auth_login.oauth_callback_label);
    expect(otherMarkup).toContain(en.auth_login.oauth_callback_button);
    expect(otherMarkup).not.toContain(en.auth_login.oauth_auto_detect_hint);
  });

  test('built-in device-code providers render exactly as before: no callback, no auto-detect step', () => {
    for (const id of ['kimi', 'kimi-ai', 'meta']) {
      const card = builtinCard(id);
      expect(supportsManualCallback(card)).toBe(false);

      const markup = renderDialog(card);
      expect(markup).not.toContain('<input');
      expect(markup).not.toContain(en.auth_login.oauth_callback_label);
      expect(markup).not.toContain(en.auth_login.oauth_auto_detect_label);
      expect(markup).not.toContain(en.auth_login.oauth_auto_detect_hint);
      // 无设备码时只有「打开授权页」一步，第 2 步保持缺省
      expect(countSteps(markup)).toBe(1);
    }

    // 设备码出现时：第 2 步是设备码，仍不出现自动检测说明或回调输入框
    const withCode = renderDialog(builtinCard('meta'), {
      status: 'waiting',
      url: 'https://meta.example/device',
      userCode: 'WDJB-MJHT',
    });
    expect(withCode).toContain('WDJB-MJHT');
    expect(withCode).not.toContain('<input');
    expect(withCode).not.toContain(en.auth_login.oauth_auto_detect_hint);
    expect(countSteps(withCode)).toBe(2);
  });

  test('CodeMaker dialog shows the auto-detect step as its second step', () => {
    expect(countSteps(renderDialog(pluginCard('cmh')))).toBe(2);
  });

  test('auto-detect copy is translated in every supported locale', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ko', 'ru', 'vi']) {
      const translations = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      for (const key of ['oauth_auto_detect_label', 'oauth_auto_detect_hint']) {
        const value = translations.auth_login[key];
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});
