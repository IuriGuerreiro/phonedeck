# mock-ui

A sandbox for trying out new UI features without touching the real app in `../app`.

- Same stack and look as `app/`: Vite, React 19, TypeScript, Tailwind v4, shadcn (`base-nova`).
- No backend and no Tauri. Each feature has its own fake backend (`mock.ts`) with fake async calls.
- Runs on port **1430**, so it can run next to `app/` (port 1420).

## Run it

```sh
cd mock-ui
npm install
npm run dev     # http://localhost:1430
# or from the repo root: npm run dev:mock
npm run build   # type-check + production build
```

The dev server listens on all network interfaces, so you can open it from other devices
on your Tailscale network: `http://<tailscale-ip>:1430` or `http://<machine>.<tailnet>.ts.net:1430`.

## Layout

```
src/
  App.tsx              # sidebar (grouped, with status badges) + Reset button
  components/ui/       # shadcn components only (copied from app/)
  components/shared/   # our own reusable pieces (e.g. charts.tsx)
  lib/utils.ts         # cn()
  lib/mock.ts          # delay(), randInt(), timeAgo() for fake backends
  mocks/               # fake backends shared by 2+ features (devices.ts, groups.ts)
  settings/            # the Settings modal (opened from the sidebar)
    sections.ts        # list of settings sections, in order
    SettingRow.tsx     # SettingSection + SettingRow layout pieces
    warmup/            # Warm-up section + its store
  features/
    index.ts           # the sidebar list, in order
    types.ts           # the Feature type
    _template/         # starter to copy; not in the sidebar
    <feature>/
      index.ts         # the feature's sidebar entry
      Page.tsx         # the page (default export)
      mock.ts          # fake data + fake API + reset()
```

## Add a feature page

1. Copy `src/features/_template/` to `src/features/<your-feature>/`.
2. In its `index.ts`, set `id`, `label`, `icon`, `group` and `status`.
3. Build the page in `Page.tsx` and its fake data and calls in `mock.ts`.
4. Add one line to the list in `src/features/index.ts`.

The page shows up in the sidebar at `#<id>`, so a reload stays on it.

Optional fields on a feature:
- `reset`: shows a "Reset mock data" button. It calls this, then reloads the page.
- `wide: true`: the page uses the full width instead of a centered column.

Status badges: `draft` = being explored, `ready` = worth building for real, `shipped` = already in `app/`.

## Add a settings section

1. Make a folder in `src/settings/<name>/` with a component built from `SettingSection` and `SettingRow`.
2. Add it to the list in `src/settings/sections.ts` (`restoreDefaults` adds the header button).
3. Open it from any page with `useSettings().openSettings("<id>")`.

## Notes

- Keep feature-only components inside the feature folder. Move a component to `src/components/shared/` only once a second feature needs it.
- `src/components/ui/`, `src/index.css`, `src/lib/utils.ts` and `components.json` are copies from `app/`. Add new shadcn components with `npx shadcn add <name>` from this folder.
