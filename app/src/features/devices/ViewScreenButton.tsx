import { Monitor } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { deviceLabel, isReady, type Device } from "@/data/devices";
import { inTauri } from "@/lib/bridge";

/** Opens a live, view-only window of the phone's screen (scrcpy). Works while a job runs. */
export function ViewScreenButton({ device: d }: { device: Device }) {
  // The window would open on the PC, not in this browser.
  if (!inTauri) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!isReady(d)}
      onClick={() => api.viewPhone(d.serial, `Tapfleet · ${deviceLabel(d)}`).catch((e) => toast.error(String(e)))}
    >
      <Monitor /> View screen
    </Button>
  );
}
