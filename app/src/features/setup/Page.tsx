// PC tools (Node, JDK, adb, Appium) and the per-phone setup guide.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setupApi, type SetupStatus } from "@/setup/api";
import { PcSetup } from "@/setup/PcSetup";
import { PhoneSetup } from "@/setup/PhoneSetup";

type Tab = "pc" | "phones";

export default function SetupPage() {
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
    refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">Setup</h1>
        <nav className="flex gap-1">
          {(["pc", "phones"] as const).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? "secondary" : "ghost"} onClick={() => setTab(t)}>
              {t === "pc" ? "This PC" : "Phones"}
            </Button>
          ))}
        </nav>
      </div>
      {tab === "pc" ? (
        <PcSetup status={status} refresh={refresh} />
      ) : (
        <PhoneSetup udev={status?.udev} refreshStatus={refresh} />
      )}
    </div>
  );
}
