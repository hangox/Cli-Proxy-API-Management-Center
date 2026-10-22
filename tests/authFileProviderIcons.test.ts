import { describe, expect, test } from 'bun:test';
import {
  AUTH_FILE_ICONS,
  getAuthFileIcon,
  normalizeProviderKey,
} from '@/features/authFiles/constants';

describe('公共认证文件图标映射', () => {
  test('CMH / CodeMaker 各别名与大小写变体均命中同一图标', () => {
    const icon = getAuthFileIcon('cmh', 'light');
    expect(icon).toBeTruthy();
    for (const alias of ['cmh', 'Cmh', 'codemaker', 'CodeMaker', 'codemaker_hub', 'CODEMAKER-HUB']) {
      expect(getAuthFileIcon(alias, 'light')).toBe(icon);
      expect(getAuthFileIcon(alias, 'dark')).toBe(icon);
    }
  });

  test('deepseek 大小写变体均命中图标', () => {
    const icon = getAuthFileIcon('deepseek', 'light');
    expect(icon).toBeTruthy();
    expect(getAuthFileIcon('Deepseek', 'dark')).toBe(icon);
  });

  test('未知 provider 仍返回 null 以便首字母回退', () => {
    expect(getAuthFileIcon('unknown-provider', 'light')).toBeNull();
    expect(getAuthFileIcon('', 'dark')).toBeNull();
  });

  test('原有品牌图标不回归，明暗主题与别名保持一致', () => {
    expect(getAuthFileIcon('claude', 'light')).toBeTruthy();
    expect(getAuthFileIcon('antigravity', 'light')).toBeTruthy();
    expect(getAuthFileIcon('codex', 'light')).toBeTruthy();
    // muse 别名归一化为 meta
    expect(getAuthFileIcon('muse', 'light')).toBe(getAuthFileIcon('meta', 'light'));
    // grok 别名归一化为 xai，明暗图标不同
    expect(getAuthFileIcon('grok', 'light')).toBe(getAuthFileIcon('xai', 'light'));
    expect(getAuthFileIcon('xai', 'light')).not.toBe(getAuthFileIcon('xai', 'dark'));
    // kimi 明暗主题图标不同
    expect(getAuthFileIcon('kimi', 'light')).not.toBe(getAuthFileIcon('kimi', 'dark'));
  });

  test('normalizeProviderKey 对新别名的归一化与映射键一致', () => {
    expect(normalizeProviderKey('Cmh')).toBe('cmh');
    expect(normalizeProviderKey('CodeMaker')).toBe('codemaker');
    expect(normalizeProviderKey('codemaker_hub')).toBe('codemaker-hub');
    expect(normalizeProviderKey('Deepseek')).toBe('deepseek');
    for (const key of ['cmh', 'codemaker', 'codemaker-hub', 'deepseek']) {
      expect(AUTH_FILE_ICONS[key]).toBeTruthy();
    }
  });
});
