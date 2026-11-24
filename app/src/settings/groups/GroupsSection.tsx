import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGroups, type Group } from "@/data/groups";
import { SettingSection } from "../SettingRow";

export function GroupsSection() {
  const { groups, error, loading, reload } = useGroups();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api.saveGroup({ id: null, name, keywords: [] });
      setName("");
      await reload();
    } catch (e) { toast.error(String(e)); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-6">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <SettingSection title="Groups">
      {loading ? <p className="px-4 py-3.5 text-sm">Loading groups…</p> : groups.length === 0 && <p className="px-4 py-3.5 text-sm text-muted-foreground">No groups yet. Create one below.</p>}
      {groups.map((g) => <GroupRow key={`${g.id}:${g.name}:${JSON.stringify(g.keywords)}`} group={g} reload={reload} />)}
    </SettingSection>
    <form onSubmit={add} className="flex gap-2">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group name" aria-label="New group name" disabled={busy} />
      <Button type="submit" disabled={busy || !name.trim()}><Plus /> Add</Button>
    </form>
    <p className="text-xs text-muted-foreground">Assign accounts from their account details. Group keywords replace global warm-up keywords. Accounts in several groups use their combined keywords. When no assigned group has keywords, global keywords apply.</p>
  </div>;
}

function GroupRow({ group, reload }: { group: Group; reload: () => Promise<void> }) {
  const [name, setName] = useState(group.name);
  const [keywords, setKeywords] = useState(group.keywords.join(", "));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.saveGroup({ id: group.id, name, keywords: keywords.split(",") });
      await reload();
      toast.success("Group saved");
    } catch (e) { toast.error(String(e)); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.deleteGroup(group.id); await reload(); }
    catch (e) { toast.error(String(e)); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-2 px-4 py-3.5">
    <div className="flex flex-wrap items-center gap-2">
      <Input className="sm:w-40" value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" disabled={busy} />
      <Input className="min-w-40 flex-1" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Keywords (comma-separated)" aria-label={`${group.name} keywords`} disabled={busy} />
      <Button size="sm" disabled={busy || !name.trim() || (name === group.name && keywords === group.keywords.join(", "))} onClick={save}>Save</Button>
      <Button variant="ghost" size="icon-sm" title={`Delete ${group.name}`} aria-label={`Delete ${group.name}`} disabled={busy} onClick={remove}><Trash2 /></Button>
    </div>
    <span className="text-xs text-muted-foreground">{group.accountIds.length} accounts · Deleting a group keeps its accounts.</span>
  </div>;
}
