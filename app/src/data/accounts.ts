// Real accounts: the accounts table, filled in by jobs run on the phones.
import { api, type Account, type PlatformId } from "@/api";
import type { WarmupOptions } from "@/settings/warmup/store";

export type { Account };

// TikTok only for now; the worker has no other platforms yet.
export const PLATFORM: PlatformId = "tiktok";

export const accountsApi = {
  list: () => api.listAccounts(),
  remove: api.deleteAccount,

  /** Reads the logged-in accounts on a phone and saves them. Returns the usernames found. */
  async sync(serial: string): Promise<string[]> {
    const r = (await api.runJob(serial, { action: "list_accounts", platform: PLATFORM })) as { accounts?: string[] };
    return r?.accounts ?? [];
  },

  switchTo: (a: Account) =>
    api.runJob(a.serial, { action: "switch_account", platform: PLATFORM, username: a.username }),

  warmUp: (a: Account, opts: WarmupOptions) =>
    api.runJob(a.serial, { action: "warmup", platform: PLATFORM, username: a.username, ...opts }),

  stop: api.stopJob,
};
