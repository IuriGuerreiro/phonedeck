// Header button that opens the setup screen (PC tools + phone guide) as an overlay.
// Opens by itself on start when a required tool is missing.
import { useCallback, useEffect, useState } from "react";
import { Wrench, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setupApi, type SetupStatus } from "./api";
import { PcSetup } from "./PcSetup";
import { PhoneSetup } from "./PhoneSetup";

type Tab = "pc" | "phones";

export function SetupLauncher() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("pc");
  const [status, setStatus] = useState<SetupStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await setupApi.status());
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  useEffect(() => {
    setupApi
      .status()
      .then((s) => {
        setStatus(s);
        if (s.tools.some((t) => !t.ok)) setOpen(true);
      })
      .catch((e) => toast.error(String(e)));
  }, []);

  const needsWork = status?.tools.some((t) => !t.ok) ?? false;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => (refresh(), setOpen(true))} className="relative">
        <Wrench /> Setup
        {needsWork && <span className="absolute top-1 right-1 size-2 rounded-full bg-red-500" />}
      </Button>
      {open && (
        <div className="fixed inset-0 z-40 flex flex-col bg-background">
          <header className="flex items-center gap-4 border-b px-6 py-3">
            <h2 className="text-base font-semibold">Setup</h2>
            <nav className="flex gap-1">
              {(["pc", "phones"] as const).map((t) => (
                <Button key={t} size="sm" variant={tab === t ? "secondary" : "ghost"} onClick={() => setTab(t)}>
                  {t === "pc" ? "This PC" : "Phones"}
                </Button>
              ))}
            </nav>
            <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setOpen(false)} title="Close">
              <X />
            </Button>
          </header>
          <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-6">
            {tab === "pc" ? (
              <PcSetup status={status} refresh={refresh} />
            ) : (
              <PhoneSetup udev={status?.udev} refreshStatus={refresh} />
            )}
          </main>
        </div>
      )}
    </>
  );
}
