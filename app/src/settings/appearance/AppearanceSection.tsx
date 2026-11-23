import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { setTheme, useThemeChoice, type ThemeChoice } from "@/lib/theme";
import { SettingRow, SettingSection } from "../SettingRow";

const OPTIONS: { id: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

export function AppearanceSection() {
  const choice = useThemeChoice();
  return (
    <SettingSection title="Appearance">
      <SettingRow label="Theme">
        <ThemePicker value={choice} onChange={setTheme} />
      </SettingRow>
    </SettingSection>
  );
}

/** Three-way segmented control. */
export function ThemePicker({ value, onChange }: { value: ThemeChoice; onChange: (t: ThemeChoice) => void }) {
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-lg border bg-muted/40 p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
            value === o.id && "bg-background text-foreground shadow-sm",
          )}
        >
          <o.icon className="size-3.5" />
          {o.label}
        </button>
      ))}
    </div>
  );
}
