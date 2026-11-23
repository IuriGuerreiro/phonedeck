import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { groupsApi, useGroups, type Group } from "@/mocks/groups";
import { SettingSection } from "../SettingRow";

/** Create groups and set each group's warm-up keywords. */
export function GroupsSection() {
  const groups = useGroups();
  const [name, setName] = useState("");

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    groupsApi.add(name);
    setName("");
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingSection title="Groups">
        {groups.length === 0 && <p className="px-4 py-3.5 text-sm text-muted-foreground">No groups yet.</p>}
        {groups.map((g) => (
          <GroupRow key={`${g.id}:${g.keywords.join(",")}`} group={g} />
        ))}
      </SettingSection>

      <form onSubmit={add} className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name, e.g. Travel" />
        <Button type="submit" disabled={!name.trim()}>
          <Plus /> Add group
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Accounts in a group use its keywords when warming up. An account in several groups uses all of them. Accounts
        with no group keywords use the global Warm-up settings.
      </p>
    </div>
  );
}

function GroupRow({ group: g }: { group: Group }) {
  // Keep keywords as typed text so commas and spaces can be edited freely.
  const [keywords, setKeywords] = useState(g.keywords.join(", "));

  const saveKeywords = () =>
    groupsApi.update(g.id, {
      keywords: keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    });

  return (
    <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center">
      <Input
        className="sm:w-40"
        value={g.name}
        onChange={(e) => groupsApi.update(g.id, { name: e.target.value })}
        aria-label="Group name"
      />
      <Input
        className="flex-1"
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        onBlur={saveKeywords}
        placeholder="Keywords, comma-separated"
        aria-label={`${g.name} keywords`}
      />
      <Button variant="ghost" size="icon-sm" title="Delete group" onClick={() => groupsApi.remove(g.id)}>
        <Trash2 />
      </Button>
    </div>
  );
}
