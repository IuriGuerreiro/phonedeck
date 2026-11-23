// Posting queue: plan videos for accounts, see what's scheduled, posted or failed.
import { useEffect, useState } from "react";
import { CalendarClock, Clock, Film, Loader2, Plus, RotateCcw, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { VideoThumb } from "@/components/shared/VideoThumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { postsApi, usePosts, type Post, type PostStatus } from "@/mocks/posts";
import { accountsApi, type Account } from "@/mocks/accounts";

const TABS: { id: string; label: string; statuses: PostStatus[] }[] = [
  { id: "upcoming", label: "Upcoming", statuses: ["scheduled", "posting"] },
  { id: "posted", label: "Posted", statuses: ["posted"] },
  { id: "failed", label: "Failed", statuses: ["failed"] },
  { id: "drafts", label: "Drafts", statuses: ["draft"] },
];

const STATUS_BADGE: Record<PostStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "Draft", variant: "outline" },
  scheduled: { label: "Scheduled", variant: "default" },
  posting: { label: "Posting…", variant: "secondary" },
  posted: { label: "Posted", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
};

export default function PostingPage() {
  const posts = usePosts();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tab, setTab] = useState("upcoming");
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    accountsApi.list().then(setAccounts);
  }, []);

  const current = TABS.find((t) => t.id === tab)!;
  const list = posts
    .filter((p) => current.statuses.includes(p.status))
    .sort((a, b) => (tab === "posted" ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)));
  const username = (id: number) => accounts.find((a) => a.id === id)?.username ?? `#${id}`;

  // Group by day so the queue reads like a simple calendar.
  const byDay = new Map<string, Post[]>();
  for (const p of list) {
    const k = new Date(p.at).toDateString();
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Posting</h1>
        <Button onClick={() => setComposing(true)} disabled={composing}>
          <Plus /> New post
        </Button>
      </div>

      {composing && <Composer accounts={accounts} onClose={() => setComposing(false)} />}

      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <Button key={t.id} size="sm" variant={tab === t.id ? "secondary" : "ghost"} onClick={() => setTab(t.id)}>
            {t.label} ({posts.filter((p) => t.statuses.includes(p.status)).length})
          </Button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No posts.</p>
      ) : (
        [...byDay].map(([dayKey, items]) => (
          <section key={dayKey} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{dayTitle(new Date(dayKey))}</h2>
            {items.map((p) => (
              <PostRow key={p.id} post={p} username={username(p.accountId)} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function PostRow({ post: p, username }: { post: Post; username: string }) {
  const s = STATUS_BADGE[p.status];
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <VideoThumb cover={p.cover} durationSec={p.durationSec} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{p.caption}</span>
            <Badge variant={s.variant}>
              {p.status === "posting" && <Loader2 className="animate-spin" />}
              {s.label}
            </Badge>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {p.hashtags.map((h) => `#${h}`).join(" ")}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <a href={`#accounts/${p.accountId}`} className="font-medium text-foreground underline-offset-4 hover:underline">
              @{username}
            </a>
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {new Date(p.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <span className="flex items-center gap-1">
              <Film className="size-3" />
              {p.video} · {p.durationSec}s
            </span>
            {p.error && <span className="text-destructive">{p.error}</span>}
          </div>
        </div>
        <div className="flex gap-1">
          {p.status === "posted" && (
            <Button size="sm" variant="ghost" nativeButton={false} render={<a href={`#video-analytics/${p.id}`} />}>
              Stats
            </Button>
          )}
          {(p.status === "scheduled" || p.status === "draft") && (
            <Button size="sm" variant="ghost" onClick={() => postsApi.postNow(p.id)}>
              <Send /> Post now
            </Button>
          )}
          {p.status === "failed" && (
            <Button size="sm" variant="outline" onClick={() => postsApi.postNow(p.id)}>
              <RotateCcw /> Retry
            </Button>
          )}
          {p.status !== "posted" && p.status !== "posting" && (
            <Button size="icon-sm" variant="ghost" title="Delete" onClick={() => postsApi.remove(p.id)}>
              <Trash2 />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Composer({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const [video, setVideo] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [when, setWhen] = useState(() => {
    const d = new Date(Date.now() + 2 * 3_600_000);
    d.setMinutes(0, 0, 0);
    return toLocalInput(d);
  });

  const hashtags = tags
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, ""))
    .filter(Boolean);
  const ready = video && caption.trim() && picked.length > 0;

  function save(status: PostStatus) {
    for (const accountId of picked) {
      postsApi.add({
        accountId,
        video: video!,
        durationSec: 15 + Math.floor(Math.random() * 45),
        caption: caption.trim(),
        hashtags,
        status,
        at: new Date(when).toISOString(),
      });
    }
    toast.success(
      status === "draft" ? "Draft saved" : `Scheduled for ${picked.length} account${picked.length > 1 ? "s" : ""}`,
    );
    onClose();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>New post</CardTitle>
        <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close">
          <X />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[auto_1fr]">
        <button
          type="button"
          onClick={() => setVideo(`clip-${Math.floor(Math.random() * 900 + 100)}.mp4`)}
          className={cn(
            "flex aspect-[9/16] w-32 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-xs text-muted-foreground hover:bg-muted/50",
            video && "border-solid bg-gradient-to-br from-sky-500 to-indigo-600 text-white",
          )}
        >
          <Film className="size-6" />
          {video ?? "Select video"}
        </button>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Caption
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={2}
              maxLength={2200}
              placeholder="Write a caption…"
              className="w-full resize-y rounded-lg border bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Hashtags
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#gym #fitness" />
          </label>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            Accounts
            <div className="flex flex-wrap gap-1">
              {accounts.map((a) => {
                const on = picked.includes(a.id);
                return (
                  <Button
                    key={a.id}
                    size="sm"
                    variant={on ? "secondary" : "outline"}
                    onClick={() => setPicked(on ? picked.filter((x) => x !== a.id) : [...picked, a.id])}
                  >
                    @{a.username}
                  </Button>
                );
              })}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:w-64">
            Schedule
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button disabled={!ready} onClick={() => save("scheduled")}>
              <CalendarClock /> Schedule
            </Button>
            <Button variant="outline" disabled={!ready} onClick={() => save("draft")}>
              Save draft
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function dayTitle(d: Date) {
  const today = new Date();
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86_400_000);
  const name = d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
  return diff === 0 ? `Today · ${name}` : diff === 1 ? `Tomorrow · ${name}` : diff === -1 ? `Yesterday · ${name}` : name;
}

/** Date → "YYYY-MM-DDTHH:MM" in local time, for datetime-local inputs. */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
