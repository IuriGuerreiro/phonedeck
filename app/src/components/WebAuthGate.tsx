// In a browser, asks for the web access token before showing the app.
// In the desktop window it renders the app straight away.
import { useEffect, useState } from "react";
import { KeyRound, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkToken, getToken, inTauri, onAuthError, reconnectEvents, setToken } from "@/lib/bridge";

export function WebAuthGate({ children }: { children: React.ReactNode }) {
  // null = checking.
  const [ok, setOk] = useState<boolean | null>(inTauri ? true : null);

  useEffect(() => {
    if (inTauri) return;
    const t = getToken();
    if (!t) return setOk(false);
    checkToken(t).then(setOk, () => setOk(false));
    return onAuthError(() => setOk(false));
  }, []);

  if (ok === null) return <div className="flex min-h-screen items-center justify-center bg-background" />;
  if (ok) return <>{children}</>;
  return (
    <TokenPrompt
      onDone={() => {
        reconnectEvents();
        setOk(true);
      }}
    />
  );
}

function TokenPrompt({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = value.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      if (await checkToken(t)) {
        setToken(t);
        onDone();
      } else {
        setError("That token is wrong.");
      }
    } catch {
      setError("Can't reach PhoneDeck. Is the app running on the PC?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-xl border p-6">
        <div className="flex items-center gap-2">
          <Smartphone className="size-5" />
          <h1 className="text-base font-semibold">PhoneDeck</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Paste the web access token. Find it in the desktop app under Settings → Web access.
        </p>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Token"
          className="font-mono"
          autoComplete="off"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy || !value.trim()}>
          <KeyRound /> {busy ? "Checking…" : "Open"}
        </Button>
      </form>
    </div>
  );
}
