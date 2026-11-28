import { useEffect, useState } from "react";
import { api, type Account, type Post, type PostStatus, type PostVisibility } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const LABELS: Record<PostStatus, string> = {
  uploading: "Uploading video", draft: "Draft", preparing: "Preparing on phone", ready: "Ready to publish",
  publishing: "Posting", submitted: "Posted", failed: "Not posted", uncertain: "Check TikTok",
};

/** Same as MAX_BYTES and MAX_CHUNK in posting.rs. A chunk travels as JSON, which must stay under the web server's 2 MB. */
const MAX_MB = 500;
const CHUNK = 384 * 1024;

export default function PostingPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("private");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    const [list, saved] = await Promise.all([api.listAccounts(), api.listPosts()]);
    setAccounts(list); setPosts(saved);
    setAccountId((id) => list.some((a) => a.id === id) ? id : list[0]?.id ?? null);
  }
  useEffect(() => { load().catch((e: unknown) => setError(String(e))); }, []);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try { await fn(); setMessage(success); }
    catch (e) { setError(String(e)); }
    finally { await load().catch((e: unknown) => setError(String(e))); setBusy(false); }
  }
  async function saveDraft(postNow: boolean) {
    if (!file || accountId === null) return;
    if (!file.name.toLowerCase().endsWith(".mp4") || file.size === 0 || file.size > MAX_MB * 1024 * 1024) {
      setError(`Choose an MP4 video up to ${MAX_MB} MB.`); return;
    }
    await action(async () => {
      const id = await api.createPost({ accountId, name: file.name, caption, visibility, bytes: file.size });
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        const chunk = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
        setMessage(`Saving video… ${Math.round(offset / file.size * 100)}%`);
        await api.uploadPostChunk(id, offset, Array.from(chunk));
      }
      await api.finishPostUpload(id);
      setCaption(""); setFile(null);
      if (postNow) { setMessage("Posting on TikTok… this can take a few minutes."); await load(); await api.postNow(id); }
    }, postNow ? "Posted. The video is on the profile." : "Draft saved.");
  }
  return <div className="flex flex-col gap-4">
    <h1 className="text-lg font-semibold">Posting</h1>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    <Card><CardHeader><CardTitle>New post</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">
      {!accounts.length && <p className="text-sm text-muted-foreground">Sync an account from the Accounts page to start posting.</p>}
      <div className="flex flex-wrap gap-1">{accounts.map((a) => <Button key={a.id} size="sm" disabled={busy} variant={a.id === accountId ? "secondary" : "outline"} onClick={() => setAccountId(a.id)}>@{a.username} · {a.serial}</Button>)}</div>
      <label className="flex flex-col gap-1 text-sm">Video <Input disabled={busy} type="file" accept="video/mp4,.mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><span className="text-xs text-muted-foreground">MP4, up to {MAX_MB} MB</span></label>
      {preview && <video className="max-h-72 max-w-full self-start rounded-lg" src={preview} controls preload="metadata" />}
      <label className="flex flex-col gap-1 text-sm">Caption and hashtags<textarea disabled={busy} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={3} className="rounded-lg border bg-transparent p-2 text-sm" placeholder="Write a caption…" /></label>
      <div className="flex items-center gap-2 text-sm">Visibility{(["private", "public"] satisfies PostVisibility[]).map((v) => <Button key={v} size="sm" disabled={busy} variant={visibility === v ? "secondary" : "outline"} onClick={() => setVisibility(v)}>{v === "private" ? "Only you" : "Everyone"}</Button>)}</div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !file || !caption.trim() || accountId === null} onClick={() => saveDraft(true)}>Post now · {visibility === "private" ? "Only you" : "Everyone"}</Button>
        <Button variant="outline" disabled={busy || !file || !caption.trim() || accountId === null} onClick={() => saveDraft(false)}>Save draft</Button>
      </div>
    </CardContent></Card>
    <div className="flex items-center justify-between"><h2 className="font-medium">Your posts</h2><Button size="sm" variant="ghost" disabled={busy} onClick={() => action(load, "Posts refreshed")}>Refresh</Button></div>
    {!posts.length && <p className="text-sm text-muted-foreground">No drafts yet.</p>}
    {posts.map((post) => <Card key={post.id}><CardContent className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">@{post.username}</span><Badge variant={post.status === "failed" || post.status === "uncertain" ? "destructive" : "secondary"}>{LABELS[post.status]}</Badge><span className="text-xs text-muted-foreground">{post.visibility === "private" ? "Only you" : "Everyone"}</span></div>
      <p className="whitespace-pre-wrap text-sm">{post.caption}</p>
      <p className="text-xs text-muted-foreground">{post.name} · {(post.bytes / 1024 / 1024).toFixed(1)} MB · {new Date(post.createdAt).toLocaleString()}</p>
      {post.error && <p className="text-sm text-destructive">{post.error}</p>}
      {post.status === "ready" && <p className="text-sm text-muted-foreground">Review the video on the phone. Publish submits it to TikTok with the caption and visibility shown here.</p>}
      {post.status === "uncertain" && <p className="text-sm text-muted-foreground">Check this account on TikTok to see whether the video was posted. This draft will not be retried automatically.</p>}
      <div className="flex flex-wrap gap-2">
        {["draft", "failed"].includes(post.status) && <Button size="sm" disabled={busy} onClick={() => action(() => api.postNow(post.id), "Posted. The video is on the profile.")}>Post now · {post.visibility === "private" ? "Only you" : "Everyone"}</Button>}
        {["draft", "failed", "ready"].includes(post.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => action(() => api.preparePost(post.id), "Video prepared. Review it on the phone, then choose Publish.")}>{post.status === "ready" ? "Prepare again" : "Prepare on phone"}</Button>}
        {post.status === "ready" && <Button size="sm" disabled={busy} onClick={() => action(() => api.publishPost(post.id), "Posted. The video is on the profile.")}>Publish · {post.visibility === "private" ? "Only you" : "Everyone"}</Button>}
        {["draft", "uploading", "failed", "ready"].includes(post.status) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => action(() => api.deletePost(post.id), "Draft deleted")}>Delete</Button>}
      </div>
    </CardContent></Card>)}
  </div>;
}
