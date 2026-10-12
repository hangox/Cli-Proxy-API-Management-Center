import { afterEach, describe, expect, test } from 'bun:test';
import { createCompactConfirmation } from '../src/features/plugins/compactConfirmation';
import { useNotificationStore } from '../src/stores/useNotificationStore';

const reset = () =>
  useNotificationStore.setState({
    confirmation: { isOpen: false, isLoading: false, options: null },
  });
afterEach(reset);
describe('Compact 宿主单槽确认', () => {
  test('已有确认时busy且不覆盖原options', async () => {
    const options = { message: '其他业务', onConfirm: () => {} };
    useNotificationStore.getState().showConfirmation(options);
    const confirmation = createCompactConfirmation(useNotificationStore, (key) => key);
    expect(await confirmation.confirm()).toBe('busy');
    expect(useNotificationStore.getState().confirmation.options).toBe(options);
    confirmation.cancel();
    expect(useNotificationStore.getState().confirmation.options).toBe(options);
  });
  test('确认/取消结果真实可区分，不自行提交请求', async () => {
    for (const outcome of ['confirmed', 'canceled'] as const) {
      reset();
      const confirmation = createCompactConfirmation(useNotificationStore, (key) => key);
      const result = confirmation.confirm();
      const options = useNotificationStore.getState().confirmation.options!;
      expect(options.title).toBe('plugin_resource.compact_confirm_title');
      if (outcome === 'confirmed') await options.onConfirm();
      else options.onCancel?.();
      expect(await result).toBe(outcome);
    }
  });
  test('清理只关闭本桥options；残留onConfirm不能改变已取消结果', async () => {
    const confirmation = createCompactConfirmation(useNotificationStore, (key) => key);
    const result = confirmation.confirm();
    const stale = useNotificationStore.getState().confirmation.options!;
    confirmation.cancel();
    expect(await result).toBe('canceled');
    expect(useNotificationStore.getState().confirmation.isOpen).toBe(false);
    await stale.onConfirm();
    expect(await result).toBe('canceled');
  });
  test('外部替换确认槽即取消本桥，不会在cleanup关闭新业务', async () => {
    const confirmation = createCompactConfirmation(useNotificationStore, (key) => key);
    const result = confirmation.confirm();
    const stale = useNotificationStore.getState().confirmation.options!;
    const newer = { message: '新业务', onConfirm: () => {} };
    useNotificationStore.getState().showConfirmation(newer);
    expect(await result).toBe('canceled');
    confirmation.cancel();
    await stale.onConfirm();
    expect(useNotificationStore.getState().confirmation.options).toBe(newer);
  });
});
