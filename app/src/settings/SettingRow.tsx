import type { ReactNode } from "react";

/** A titled group of setting rows, like the sections in the settings modal. */
export function SettingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="divide-y rounded-xl border bg-card">{children}</div>
    </section>
  );
}

/** One setting: label and description on the left, control on the right. */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <div className="shrink-0 sm:w-64">{children}</div>
    </div>
  );
}
