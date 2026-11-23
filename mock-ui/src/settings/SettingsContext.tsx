import { createContext, useContext, useState, type ReactNode } from "react";

import { settingsSections } from "./sections";
import { SettingsModal } from "./SettingsModal";

type Ctx = { openSettings: (sectionId?: string) => void };

const SettingsContext = createContext<Ctx>({ openSettings: () => {} });

/** Lets any page open the settings modal, e.g. openSettings("warmup"). */
export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<string | null>(null);

  return (
    <SettingsContext.Provider
      value={{ openSettings: (id) => setSection(id ?? settingsSections[0].id) }}
    >
      {children}
      {section && (
        <SettingsModal section={section} onSection={setSection} onClose={() => setSection(null)} />
      )}
    </SettingsContext.Provider>
  );
}
