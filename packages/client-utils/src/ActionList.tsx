/**
 * ActionList primitive — horizontal row of action buttons.
 *
 * Registered as `ui:action-list` in the primitive registry. Plugins emit
 * `{primitive: "ui:action-list", props: {actions: [...]}}` and each
 * connected client renders this component.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
import Icon from "@mdi/react";
// Generated dynamic-key table — replaces a namespace import of the full
// @mdi/js module, which defeated tree-shaking (all ~7,000 icons in the eager
// bundle). See change: trim-cold-start-transfer-and-config-fanout (②).
import dynamicMdiKeys from "@blackbelt-technology/pi-dashboard-shared/dynamic-mdi-keys.json";
// We accept icon as a string key (MDI), look up via resolveMdiIcon at render time.
import type { UiActionListProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { sendPluginAction } from "@blackbelt-technology/dashboard-plugin-runtime";

/**
 * Extended item shape: in addition to `onClick`, items may carry a
 * server-side action descriptor in `dataAction`. When the user clicks,
 * `dataAction` (if present) is dispatched via `sendPluginAction`.
 * Plugins emitting intents use `dataAction`; direct React callers can
 * still pass `onClick`.
 */
interface ExtendedActionItem {
  label: string;
  icon?: string;
  tooltip?: string;
  onClick?: () => void;
  disabled?: boolean;
  dataAction?: {
    pluginId: string;
    sessionId?: string | null;
    action: string;
    payload?: Record<string, unknown>;
  };
}

export function ActionList({ actions }: UiActionListProps) {
  if (!actions || actions.length === 0) return null;
  return (
    <div className="flex flex-row flex-wrap gap-1 items-center">
      {(actions as ExtendedActionItem[]).map((a, i) => {
        const handleClick = () => {
          if (a.disabled) return;
          if (a.dataAction) {
            sendPluginAction(
              a.dataAction.pluginId,
              a.dataAction.sessionId ?? null,
              a.dataAction.action,
              a.dataAction.payload,
            );
          }
          if (a.onClick) a.onClick();
        };
        return (
          <button
            key={i}
            type="button"
            onClick={handleClick}
            disabled={a.disabled}
            title={a.tooltip}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
          >
            {a.icon ? <IconByKey iconKey={a.icon} /> : null}
            <span>{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Render an MDI icon by its export-name key. Best-effort — unknown keys
 * render nothing (the generated dynamic-key table is the allowlist).
 */
function IconByKey({ iconKey }: { iconKey: string }) {
  const candidate = (dynamicMdiKeys as Record<string, unknown>)[iconKey];
  const path = typeof candidate === "string" ? candidate : null;
  if (!path) return null;
  return <Icon path={path} size={0.6} />;
}
