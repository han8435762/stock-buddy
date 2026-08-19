import { ipcBridge } from '@/common';
import type { ClaudeAuthStatus, ClaudeCodeEnv } from '@/common/types/claudeCodeConfig';
import useSWR, { type SWRConfiguration } from 'swr';

const ENV_KEY = 'claude-code:config';
const AUTH_KEY = 'claude-code:auth';

/** Keep it stable after the initial load; only explicit mutate() refreshes it. */
const SWR_OPTIONS: SWRConfiguration<ClaudeCodeEnv, Error> = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  shouldRetryOnError: false,
};

const AUTH_SWR_OPTIONS: SWRConfiguration<ClaudeAuthStatus, Error> = {
  revalidateOnFocus: true, // reflect a login done in the terminal
  revalidateOnReconnect: false,
  shouldRetryOnError: false,
};

export const fetchClaudeCodeEnv = async (): Promise<ClaudeCodeEnv> =>
  (await ipcBridge.claudeCode.getEnv.invoke()) ?? {};

export const fetchClaudeAuthStatus = async (): Promise<ClaudeAuthStatus> =>
  (await ipcBridge.claudeCode.getAuthStatus.invoke()) ?? 'not_authorized';

export const useClaudeCodeConfig = () => {
  const envSwr = useSWR<ClaudeCodeEnv>(ENV_KEY, fetchClaudeCodeEnv, SWR_OPTIONS);
  const authSwr = useSWR<ClaudeAuthStatus>(AUTH_KEY, fetchClaudeAuthStatus, AUTH_SWR_OPTIONS);
  return {
    data: envSwr.data,
    mutate: envSwr.mutate,
    authStatus: authSwr.data,
    mutateAuth: authSwr.mutate,
  };
};
