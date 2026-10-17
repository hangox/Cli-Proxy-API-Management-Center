import type { useNotificationStore } from '@/stores/useNotificationStore';

type Store = Pick<typeof useNotificationStore, 'getState' | 'subscribe'>;

// 宿主确认框是单槽：忙时拒绝，退出时只清理本桥拥有的槽位。
export function createCompactConfirmation(store: Store, translate: (key: string) => string) {
  let cancelCurrent: (() => void) | null = null;
  const confirm = (): Promise<'confirmed' | 'canceled' | 'busy'> => {
    const notifications = store.getState();
    if (notifications.confirmation.isOpen || notifications.confirmation.isLoading) {
      return Promise.resolve('busy');
    }
    return new Promise((resolve) => {
      let settled = false;
      let unsubscribe = () => {};
      const settle = (decision: 'confirmed' | 'canceled') => {
        if (settled) return;
        settled = true;
        unsubscribe();
        cancelCurrent = null;
        resolve(decision);
      };
      const confirmation = {
        title: translate('plugin_resource.compact_confirm_title'),
        message: translate('plugin_resource.compact_confirm_message'),
        onConfirm: () => settle('confirmed'),
        onCancel: () => settle('canceled'),
      };
      cancelCurrent = () => {
        settle('canceled');
        if (store.getState().confirmation.options === confirmation) {
          store.getState().hideConfirmation();
        }
      };
      unsubscribe = store.subscribe((state) => {
        if (!state.confirmation.isOpen || state.confirmation.options !== confirmation) {
          settle('canceled');
        }
      });
      notifications.showConfirmation(confirmation);
    });
  };
  return { confirm, cancel: () => cancelCurrent?.() };
}
