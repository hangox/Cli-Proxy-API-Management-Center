/**
 * Guard for the QuotaClassMap ↔ SCSS contract.
 *
 * `bindQuotaClasses` throws at *module initialization*, and both hosts bind at
 * import time — so a contract key missing from either stylesheet does not
 * degrade one row, it white-screens the whole application. This converts that
 * into a failing test.
 *
 * The check is textual rather than a module import on purpose: under `bun test`
 * a `.module.scss` import resolves to the raw stylesheet source (a string), not
 * to the class-name object Vite produces for the browser build. Asserting on
 * keys of that object would silently pass for every key.
 */

import { describe, expect, test } from 'bun:test';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';

const HOSTS = {
  'QuotaBody.module.scss': 'src/features/quota/components/QuotaBody.module.scss',
  'AuthFileQuota.module.scss': 'src/features/authFiles/components/AuthFileQuota.module.scss',
} as const;

const readHost = async (path: string): Promise<string> => {
  const content = await Bun.file(new URL(`../${path}`, import.meta.url)).text();
  const dir = path.slice(0, path.lastIndexOf('/'));
  let resolved = content;
  for (const match of content.matchAll(/@use\s+['"]([^'"]+)['"]/g)) {
    const importTarget = match[1];
    if (importTarget.startsWith('.')) {
      const lastSlash = importTarget.lastIndexOf('/');
      const prefix = lastSlash === -1 ? '' : importTarget.slice(0, lastSlash + 1);
      const name = lastSlash === -1 ? importTarget : importTarget.slice(lastSlash + 1);
      const candidates = [
        `${dir}/${prefix}_${name}.scss`,
        `${dir}/${prefix}${name}.scss`,
        `${dir}/${prefix}${name}.module.scss`,
      ];
      for (const candidate of candidates) {
        const file = Bun.file(new URL(`../${candidate}`, import.meta.url));
        if (await file.exists()) {
          resolved += '\n' + (await file.text());
          break;
        }
      }
    }
  }
  return resolved;
};

describe('quota class contract', () => {
  for (const [host, path] of Object.entries(HOSTS)) {
    test(`${host} defines every QuotaClassMap key`, async () => {
      const css = await readHost(path);
      const missing = QUOTA_CLASS_KEYS.filter(
        (key) => !new RegExp(`^\\s*\\.${key}\\b`, 'm').test(css)
      );
      expect(missing).toEqual([]);
    });
  }

  test('bindQuotaClasses reports every missing key rather than the first', () => {
    const partial = Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, `_${key}`]));
    delete partial.quotaReset;
    delete partial.quotaResetRelative;

    expect(() => bindQuotaClasses(partial, 'test-host')).toThrow(/quotaReset.*quotaResetRelative/);
  });

  test('bindQuotaClasses returns exactly the contract keys', () => {
    const full = Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, `_${key}`]));
    const bound = bindQuotaClasses({ ...full, strayKey: '_stray' }, 'test-host');

    expect(Object.keys(bound).sort()).toEqual([...QUOTA_CLASS_KEYS].sort());
  });
});
