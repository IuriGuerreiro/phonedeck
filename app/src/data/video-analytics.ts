import type { VideoMeasurement, VideoReading } from "@/api";

export type SavedVideo = VideoMeasurement & { accountId: number; capturedAt: string; key: string };
export const videoKey = (accountId: number, platformVideoId: string) => `${accountId}:${platformVideoId}`;
export function latestVideos(readings: VideoReading[]): SavedVideo[] {
  const videos = new Map<string, SavedVideo>();
  for (const reading of readings) for (const video of reading.videos) {
    const key = videoKey(reading.accountId, video.platformVideoId);
    videos.set(key, { ...video, key, accountId: reading.accountId, capturedAt: reading.capturedAt });
  }
  return [...videos.values()];
}
export function engagement(video: VideoMeasurement): number | null {
  if (video.views === 0 || video.likes === null || video.comments === null || video.shares === null) return null;
  return (video.likes + video.comments + video.shares) / video.views;
}
