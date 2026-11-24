export type VideoMeasurement = {
  platformVideoId: string;
  url: string;
  caption: string;
  views: number;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
};

export function countFromLabel(label: string, parse: (value: string) => number): number | null {
  const match = label.match(/(?:^|\s)(\d+(?:[.,]\d+)*(?:\s*(?:[kKmMbB]|mil|mi))?)(?=\s|$)/);
  return match ? parse(match[1]) : null;
}

export function videoIdentity(link: string): { platformVideoId: string; url: string } {
  const url = new URL(link);
  if (url.protocol !== "https:" || !(url.hostname === "tiktok.com" || url.hostname.endsWith(".tiktok.com"))) {
    throw new Error("The copied link is not a TikTok video");
  }
  const match = url.pathname.match(/^\/@([^/]+)\/(video|photo)\/(\d+)\/?$/);
  if (!match) throw new Error("TikTok did not expose a permanent video link");
  return { platformVideoId: match[3], url: `https://www.tiktok.com/@${match[1]}/${match[2]}/${match[3]}` };
}
