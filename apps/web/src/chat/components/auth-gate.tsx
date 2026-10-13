import { Button } from "@/components/ui/button";
import { GoogleSignIn } from "./google-sign-in.tsx";

/**
 * Renders the signed-out gate with login and guest options.
 *
 * @param props - Component props.
 * @param props.ready - Whether the identity request has completed.
 * @param props.error - Current error message, if any.
 * @param props.loginError - Login failure message, if any.
 * @param props.onGuest - Callback that starts a guest session.
 * @returns The rendered sign-in gate.
 */
export function AuthGate({
  ready,
  error,
  loginError,
  onGuest,
}: {
  ready: boolean;
  error: string | null;
  loginError: string | null;
  onGuest: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-5 px-6">
      <h1 className="text-2xl font-medium">Ecommerce analytics</h1>
      <p className="text-sm leading-7 text-muted-foreground">
        Explore the GA4 ecommerce sample with private conversations.
      </p>
      {error && <p role="alert">{error}</p>}
      {loginError && <p role="alert">{loginError}</p>}
      {ready ? (
        <>
          <GoogleSignIn className="border px-4 py-3 text-center text-sm" />
          <Button type="button" variant="outline" onClick={onGuest}>
            Continue as guest
          </Button>
        </>
      ) : (
        <p>Loading account…</p>
      )}
    </main>
  );
}
