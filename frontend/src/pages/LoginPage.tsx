import { AnimatePresence } from 'framer-motion';
import { Lock, Mail } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import type { LoginLocationState } from '../auth/guards';
import { useLogin, useSession } from '../auth/session';
import { emailProblem } from '../auth/validation';
import { AuthShell } from '../components/auth/AuthShell';
import { FormAlert, formatWait, SubmitButton, TextField } from '../components/auth/FormControls';
import { useCountdown } from '../hooks/useCountdown';
import { ApiError } from '../lib/api';

interface FieldErrors {
  email?: string;
  password?: string;
}

export default function LoginPage() {
  const session = useSession();
  const login = useLogin();
  const location = useLocation();
  const [params] = useSearchParams();
  const { remaining, start: startWait } = useCountdown();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState(() => (location.state as LoginLocationState | null)?.notice);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const error = login.error;
  const apiError = error instanceof ApiError ? error : null;

  // A 429 locks the form for the server's Retry-After.
  useEffect(() => {
    if (apiError?.status === 429) startWait(apiError.retryAfter ?? 60);
  }, [apiError, startWait]);

  // Wrong credentials: keep the email, select the password for a quick retype.
  useEffect(() => {
    if (apiError?.status === 401) passwordRef.current?.select();
  }, [apiError]);

  const locked = remaining > 0;
  const offline = session.isError && session.error instanceof ApiError && session.error.isNetwork;
  const signupOpen = session.data?.allowSignup !== false;
  const next = params.get('next');

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (login.isPending || locked) return;

    const errors: FieldErrors = {
      email: emailProblem(email) ?? undefined,
      password: password ? undefined : 'Enter your password.',
    };
    setFieldErrors(errors);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();

    setNotice(undefined);
    // Server limit is 200 characters; it trims and lower-cases the email itself.
    login.mutate({ email: email.trim(), password });
  }

  const clearFieldError = (key: keyof FieldErrors) => setFieldErrors((f) => (f[key] ? { ...f, [key]: undefined } : f));

  let banner: { tone: 'error' | 'offline' | 'info' | 'success'; text: string } | null = null;
  if (locked) banner = { tone: 'error', text: `Too many sign-in attempts. Try again in ${formatWait(remaining)}.` };
  else if (apiError?.isNetwork || (offline && !login.isPending && !apiError)) {
    banner = { tone: 'offline', text: 'Can’t reach the SpendWise server. Make sure the backend is running, then try again.' };
  } else if (apiError && apiError.status !== 429) banner = { tone: 'error', text: apiError.message };
  else if (error && !apiError) banner = { tone: 'error', text: 'Could not sign in. Please try again.' };
  else if (notice === 'logout') banner = { tone: 'success', text: 'You’re signed out. See you soon.' };
  else if (notice === 'expired') banner = { tone: 'info', text: 'Your session ended. Sign in again to pick up where you left off.' };
  else if (next) banner = { tone: 'info', text: 'Sign in to continue.' };

  const busy = login.isPending || login.isSuccess;

  return (
    <AuthShell
      documentTitle="Sign in"
      title="Welcome back"
      subtitle="Sign in to the books you keep on this server."
      footer={
        signupOpen ? (
          <>
            New to SpendWise?{' '}
            <Link
              to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
              className="font-semibold text-accent hover:underline"
            >
              Create an account
            </Link>
          </>
        ) : (
          <>New accounts are turned off on this server. Ask its owner for one.</>
        )
      }
    >
      <form noValidate onSubmit={onSubmit} className="space-y-4" aria-busy={busy || undefined}>
        <AnimatePresence initial={false} mode="wait">
          {banner && (
            <FormAlert key={banner.text} tone={banner.tone}>
              {banner.text}
            </FormAlert>
          )}
        </AnimatePresence>

        <TextField
          ref={emailRef}
          label="Email"
          type="email"
          icon={Mail}
          value={email}
          onChange={(v) => {
            setEmail(v);
            clearFieldError('email');
          }}
          error={fieldErrors.email}
          placeholder="you@example.com"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          autoFocus
          disabled={busy}
        />

        <TextField
          ref={passwordRef}
          label="Password"
          type="password"
          icon={Lock}
          value={password}
          onChange={(v) => {
            setPassword(v);
            clearFieldError('password');
          }}
          error={fieldErrors.password}
          placeholder="Your password"
          autoComplete="current-password"
          maxLength={200}
          disabled={busy}
        />

        <div className="pt-2">
          <SubmitButton pending={busy} pendingLabel="Signing in…" disabled={locked}>
            {locked ? `Try again in ${formatWait(remaining)}` : 'Sign in'}
          </SubmitButton>
        </div>

        <p className="text-center text-xs text-muted">
          Forgot your password? The server owner can reset it with{' '}
          <code className="rounded bg-subtle px-1 py-0.5 font-mono text-[11px]">npm run user:reset-password</code>.
        </p>
      </form>
    </AuthShell>
  );
}
