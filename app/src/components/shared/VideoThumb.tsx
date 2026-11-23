import { cn } from "@/lib/utils";

/** Fake 9:16 video thumbnail: a gradient with the length in the corner. */
export function VideoThumb({ cover, durationSec, className }: { cover: string; durationSec: number; className?: string }) {
  return (
    <div className={cn("relative aspect-[9/16] w-12 shrink-0 overflow-hidden rounded-md bg-gradient-to-br", cover, className)}>
      <span className="absolute right-0.5 bottom-0.5 rounded bg-black/60 px-1 text-[9px] text-white">{durationSec}s</span>
    </div>
  );
}
