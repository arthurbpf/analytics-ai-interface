import type { Activity } from "@analytics/contracts";
import { CheckIcon, CircleNotchIcon, XIcon } from "@phosphor-icons/react";

const statusLabels = {
  preparing: "Preparing",
  running: "Running",
  completed: "Done",
  failed: "Failed",
};

export function ActivityList({
  activities,
  progress,
}: {
  activities: Activity[];
  progress: string;
}) {
  return (
    <div className="space-y-2 text-xs text-muted-foreground" data-testid="agent-activity">
      <output aria-live="polite" aria-atomic="true">
        {progress}
      </output>
      {activities.length > 0 && (
        <ol aria-label="Analysis activity" className="space-y-2 border-l pl-3">
          {activities.map((activity) => (
            <li key={activity.id} data-status={activity.status} className="flex items-center gap-2">
              {activity.status === "completed" ? (
                <CheckIcon aria-hidden="true" />
              ) : activity.status === "failed" ? (
                <XIcon aria-hidden="true" className="text-destructive" />
              ) : (
                <CircleNotchIcon
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              )}
              <span className="min-w-0 flex-1">{activity.message}</span>
              <span>{statusLabels[activity.status]}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
