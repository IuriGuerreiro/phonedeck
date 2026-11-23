import { useEffect, useState } from "react";
import { Check, Copy, LogOut } from "lucide-react";
import { toast } from "sonner";

import { api, type WebInfo } from "@/api";
import { Button } from "@/components/ui/button";
import { inTauri, setToken } from "@/lib/bridge";
import { SettingRow, SettingSection } from "../SettingRow";

export function WebAccessSection() {
  const [info, setInfo] = useState<WebInfo | null>(null);

  useEffect(() => {
    api.webInfo().then(setInfo, (e) => toast.error(String(e)));
  }, []);

  if (!inTauri) {
    return (
      <SettingSection title="This browser">
        <SettingRow label="Signed in" description="Forget the token on this browser.">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setToken(null);
              window.location.reload();
            }}
          >
            <LogOut /> Sign out
          </Button>
        </SettingRow>
      </SettingSection>
    );
  }

  if (!info) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="flex flex-col gap-8">
      <SettingSection title="Open PhoneDeck in a browser">
        {!info.enabled ? (
          <p className="text-sm text-muted-foreground">
            {info.error ?? "Web access is off (SMA_WEB=0)."}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Any device that can reach this PC (same Wi-Fi or Tailscale) can open these links. The link includes the
              token, so treat it like a password.
            </p>
            {info.urls.map((url) => (
              <SettingRow key={url} label={url}>
                <CopyButton text={`${url}/?token=${info.token}`} label="Copy link" />
              </SettingRow>
            ))}
          </>
        )}
      </SettingSection>

      <SettingSection title="Token">
        <SettingRow label="Token" description="Paste this if a browser asks for it.">
          <div className="flex items-center gap-2">
            <code className="max-w-48 truncate rounded bg-muted px-2 py-1 text-xs">{info.token}</code>
            <CopyButton text={info.token} label="Copy" />
          </div>
        </SettingRow>
      </SettingSection>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => toast.error("Couldn't copy"),
        )
      }
    >
      {done ? <Check /> : <Copy />} {done ? "Copied" : label}
    </Button>
  );
}
