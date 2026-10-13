# Chat frontend

`chat-page.tsx` composes the feature. Files use descriptive kebab-case names, and
tests live beside the code they cover.

- `api/`: HTTP transport, query keys/options, and polling predicates.
- `state/`: the provider, Zustand client state, stream runtime, event updates,
  preferences, and published-history recovery.
- `hooks/`: identity actions, session/history queries, submission actions, URL
  selection, and transcript scrolling.
- `components/`: chat presentation with explicit data and callback props.
- `charts/`: saved-result visualizations, plotting data, and cell formatting.
- `testing/`: shared fixtures and isolated API/provider/router test helpers.

TanStack Query owns identity, sessions, and saved histories. Private query keys
include the owning identity. Zustand owns live responses, selection, preferences,
and operation errors; abort controllers stay in the runtime. The URL drives
selection after the initial saved preference is restored.

Components consume hooks or receive props; hooks coordinate state and API code.
API code does not import state or UI modules. Use direct imports rather than barrel
exports. Streaming submissions are never retried; polling and recovery only read
saved data.
