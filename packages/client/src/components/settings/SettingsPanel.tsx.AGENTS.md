# SettingsPanel.tsx — index

Settings UI: left-nav rail and page content for dashboard, network, extension, resource, and advanced settings. `SettingsPanel` owns the unified Save draft registry, config/provider dirty tracking, page dirty indicators, unsaved-navigation guards, and correlated server restart handling. The General > Interface page keeps `compactSidebar` / `onCompactSidebarChange` as a browser-local preference outside config Save/dirty state, and edits the upstream `dashboardName` PWA label through the config draft.

The panel accepts upstream `availableModels?: ModelInfo[]`, merges session-reported models with the fetched catalogue, and preserves explicit-model behavior. Provider settings retain cached health, auth-event dispatch after successful provider saves, and live test updates. Gateway pairing, runtime status and selection, model settings, provider contracts, restart requirements, partial-save behavior, and dirty-state guards remain upstream behavior.

`DisplayPrefsSection` remains one buffered `display-prefs` source. `NumberField`, `ToggleField`, `SelectField`, and `TextField` use the shared required-hint contract; `GatedGroup` is presentational. `dashboardName` belongs to General > Interface and is mapped to the General dirty page.
