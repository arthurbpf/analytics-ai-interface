/**
 * Renders the Google sign-in link.
 *
 * @param props - Component props.
 * @param props.className - Optional classes applied to the link.
 * @returns The rendered sign-in link.
 */
export function GoogleSignIn({ className }: { className?: string }) {
  return (
    <a className={className} href="/api/auth/google">
      Sign in with Google
    </a>
  );
}
