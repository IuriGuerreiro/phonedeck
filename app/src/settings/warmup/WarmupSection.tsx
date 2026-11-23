import { Input } from "@/components/ui/input";
import { SettingRow, SettingSection } from "../SettingRow";
import { setWarmup, useWarmupSettings, type WarmupForm } from "./store";

export function WarmupSection() {
  const form = useWarmupSettings();
  const set = (key: keyof WarmupForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setWarmup({ ...form, [key]: e.target.value });

  return (
    <div className="flex flex-col gap-8">
      <SettingSection title="Session">
        <SettingRow label="Duration (min)" description="Per account (1–120)">
          <Input type="number" min={1} max={120} value={form.minutes} onChange={set("minutes")} />
        </SettingRow>
        <SettingRow label="Watch time (sec)" description="Random range per video">
          <div className="flex items-center gap-1.5">
            <Input type="number" min={1} max={600} value={form.watchMinSec} onChange={set("watchMinSec")} />
            <span className="text-muted-foreground">–</span>
            <Input type="number" min={1} max={600} value={form.watchMaxSec} onChange={set("watchMaxSec")} />
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection title="Engagement">
        <SettingRow label="Like rate">
          <PercentInput value={form.likePct} onChange={set("likePct")} />
        </SettingRow>
        <SettingRow label="Follow rate">
          <PercentInput value={form.followPct} onChange={set("followPct")} />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Targeting">
        <SettingRow label="Keywords" description="Comma-separated. Leave blank for For You feed.">
          <Input value={form.keywords} onChange={set("keywords")} placeholder="gym workout, meal prep" />
        </SettingRow>
      </SettingSection>
    </div>
  );
}

function PercentInput(props: { value: string; onChange: React.ChangeEventHandler<HTMLInputElement> }) {
  return (
    <div className="flex items-center gap-1.5">
      <Input type="number" min={0} max={100} {...props} />
      <span className="text-sm text-muted-foreground">%</span>
    </div>
  );
}
