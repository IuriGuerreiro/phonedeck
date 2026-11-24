import type { Browser } from "../devices.ts";

export type PlatformId = "tiktok";

export type Platform = {
  id: PlatformId;
  package: string;
  /**
   * Go to a swipeable video feed: the main feed, or videos found by searching
   * `keyword` when given. Throws if the app is not in a usable state.
   */
  openFeed(s: Browser, keyword?: string): Promise<void>;
  /** True when a full-screen video is on screen and ready to swipe. */
  isOnFeed(s: Browser): Promise<boolean>;
  /** Follow the creator of the video on screen. False if there's no follow button (already following). */
  follow(s: Browser): Promise<boolean>;
  /** Double-tap likes the current video on this feed. */
  doubleTapLikes: boolean;
  /** Usernames logged in on this phone, current one first. */
  listAccounts(s: Browser): Promise<string[]>;
  readAccountStats(s: Browser): Promise<{ username: string; followers: number; following: number; likes: number }>;
  /** Make `username` the active account. */
  switchAccount(s: Browser, username: string): Promise<void>;
};

/**
 * The app shows something the automation must not click through, such as a
 * verification checkpoint or a login screen. A person has to look at the phone.
 */
export class NeedsAttention extends Error {
  code = "needs_attention" as const;
}
