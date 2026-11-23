import { tiktok } from "./tiktok.ts";
import type { Platform, PlatformId } from "./types.ts";

export { NeedsAttention, type Platform, type PlatformId } from "./types.ts";

// Only TikTok for now. Add a platform by writing ./<name>.ts and listing it here.
const PLATFORMS: Record<PlatformId, Platform> = { tiktok };

export function platform(id: string): Platform {
  const p = PLATFORMS[id as PlatformId];
  if (!p) throw new Error(`Unknown or unsupported platform: ${id}`);
  return p;
}
