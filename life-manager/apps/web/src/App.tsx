import React, { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrivacyMaskProvider } from '@hermes/ui';
import { AppRouter, normalizePathname, type AppRouterProps } from './router';

export { AppRouter, normalizePathname, type AppRouterProps };

export interface AppProps {
  initialPath?: string;
}

export function App({ initialPath }: AppProps = {}) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <PrivacyMaskProvider storageKey="hermes-fui-privacy-mask">
        <AppRouter initialPath={initialPath} />
      </PrivacyMaskProvider>
    </QueryClientProvider>
  );
}
export default App;
