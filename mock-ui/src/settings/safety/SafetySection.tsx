import { Switch } from "@/components/shared/Switch";
import { Input } from "@/components/ui/input";
import { SettingRow, SettingSection } from "../SettingRow";
import { setSafety, useSafety, type SafetyLimits } from "./store";

type NumKey = { [K in keyof SafetyLimits]: SafetyLimits[K] extends number ? K : never }[keyof SafetyLimits];

export function SafetySection() {
  const l = useSafety();
  const set = <K extends keyof SafetyLimits>(k: K, v: SafetyLimits[K]) => setSafety({ ...l, [k]: v });
  const num = (k: NumKey, min: number, max: number) => (
    <Input
      type="number"
      min={min}
      max={max}
      value={l[k]}
      onChange={(e) => set(k, Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
    />
  );

  return (
    <div className="flex flex-col gap-8">
      <SettingSection title="Daily limits per account">
        <SettingRow label="Max likes per day" description="Likes stop for the day once an account hits this.">
          {num("maxLikesPerDay", 0, 1000)}
        </SettingRow>
        <SettingRow label="Max follows per day" description="New accounts should stay low, around 5–15.">
          {num("maxFollowsPerDay", 0, 200)}
        </SettingRow>
        <SettingRow label="Max warm-up minutes per day" description="Warm-ups end early once an account reaches this.">
          {num("maxMinutesPerDay", 1, 600)}
        </SettingRow>
      </SettingSection>

      <SettingSection title="Quiet hours">
        <SettingRow label="Pause at night" description="Nothing runs between these times. Running jobs finish their current video, then stop.">
          <div className="flex justify-end">
            <Switch label="Quiet hours" checked={l.quietHoursOn} onChange={(v) => set("quietHoursOn", v)} />
          </div>
        </SettingRow>
        {l.quietHoursOn && (
          <SettingRow label="From – to" description="Uses this PC's time zone. Can cross midnight.">
            <div className="flex items-center gap-1.5">
              <Input type="time" value={l.quietStart} onChange={(e) => set("quietStart", e.target.value)} />
              <span className="text-muted-foreground">–</span>
              <Input type="time" value={l.quietEnd} onChange={(e) => set("quietEnd", e.target.value)} />
            </div>
          </SettingRow>
        )}
      </SettingSection>

      <SettingSection title="Random breaks">
        <SettingRow label="Take random breaks" description="Puts the phone down for a bit, like a real person would.">
          <div className="flex justify-end">
            <Switch label="Random breaks" checked={l.breaksOn} onChange={(v) => set("breaksOn", v)} />
          </div>
        </SettingRow>
        {l.breaksOn && (
          <>
            <SettingRow label="Break every (minutes)" description="A random time in this range.">
              <div className="flex items-center gap-1.5">
                {num("breakEveryMin", 1, 120)}
                <span className="text-muted-foreground">–</span>
                {num("breakEveryMax", 1, 120)}
              </div>
            </SettingRow>
            <SettingRow label="Break length (minutes)" description="A random time in this range.">
              <div className="flex items-center gap-1.5">
                {num("breakLengthMin", 1, 60)}
                <span className="text-muted-foreground">–</span>
                {num("breakLengthMax", 1, 60)}
              </div>
            </SettingRow>
          </>
        )}
      </SettingSection>
    </div>
  );
}
