import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import { installCompactBroker, type CompactTheme } from './compactBroker';
import { createCompactConfirmation } from './compactConfirmation';

export function resolveCompactTheme(theme: string, resolved: string): CompactTheme {
  if (theme === 'white' || theme === 'light' || theme === 'dark') return theme;
  return resolved === 'dark' ? 'dark' : 'white';
}

export function useCompactBroker(
  frameRef: RefObject<HTMLIFrameElement | null>,
  options: { active: boolean; pluginID: string; iframeSrc: string; apiBase: string }
) {
  const { t } = useTranslation();
  const translate = useRef(t);
  useLayoutEffect(() => {
    translate.current = t;
  }, [t]);
  const { active, pluginID, iframeSrc, apiBase } = options;

  useLayoutEffect(() => {
    if (!active) return;
    const confirmation = createCompactConfirmation(useNotificationStore, (key) =>
      translate.current(key)
    );
    return installCompactBroker({
      host: window,
      origin: window.location.origin,
      pluginID,
      iframeSrc,
      apiBase,
      getFrame: () => frameRef.current,
      isAuthenticated: () => {
        const auth = useAuthStore.getState();
        return (
          auth.isAuthenticated && auth.connectionStatus === 'connected' && auth.apiBase === apiBase
        );
      },
      getRevision: () => apiClient.getConnectionRevision(),
      getTheme: () => {
        const theme = useThemeStore.getState();
        return resolveCompactTheme(theme.theme, theme.resolvedTheme);
      },
      createChannel: () => new MessageChannel(),
      request: (request, revision, signal) => {
        const config = { signal, expectedConnectionRevision: revision, params: request.query };
        return request.method === 'PUT'
          ? apiClient.put(request.url, request.body, config)
          : apiClient.get(request.url, config);
      },
      confirm: confirmation.confirm,
      cancelConfirmation: confirmation.cancel,
      subscribeAuth: (listener) => useAuthStore.subscribe(listener),
      subscribeTheme: (listener) => useThemeStore.subscribe(listener),
    });
  }, [active, pluginID, iframeSrc, apiBase, frameRef]);
}
