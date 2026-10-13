import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Renders the dismissible status and error banner.
 *
 * @param props - Component props.
 * @param props.warning - Storage warning message, if any.
 * @param props.error - Current error message, if any.
 * @param props.navigationError - URL synchronization error, if any.
 * @param props.loginError - Login failure message, if any.
 * @param props.onReload - Callback that reloads saved history.
 * @returns The rendered banner, or null when there is nothing to show.
 */
export function StatusAlerts({
  warning,
  error,
  navigationError,
  loginError,
  onReload,
}: {
  warning: string | null;
  error: string | null;
  navigationError: string | null;
  loginError: string | null;
  onReload: () => void;
}) {
  if (!warning && !error && !navigationError && !loginError) {
    return null;
  }
  return (
    <Alert variant={error ? "destructive" : "default"}>
      <AlertDescription>
        {error ?? navigationError ?? loginError ?? warning}
        <Button type="button" variant="link" onClick={onReload}>
          Reload saved history
        </Button>
      </AlertDescription>
    </Alert>
  );
}
