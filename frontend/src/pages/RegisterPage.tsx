import { AnimatePresence } from 'framer-motion';
import { KeyRound, Lock, Mail, ShieldOff, UserRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useRegister, useSession } from '../auth/session';
import { emailProblem, NAME_MAX, nameProblem, passwordChecks, passwordProblem } from '../auth/validation';
import { AuthShell } from '../components/auth/AuthShell';
import { FormAlert, formatWait, PasswordChecklist, SubmitButton, TextField } from '../components/auth/FormControls';
import { useCountdown } from '../hooks/useCountdown';
import { ApiError } from '../lib/api';

type Field = 'displayName' | 'email' | 'password' | 'confirm';
type FieldErrors = Partial<Record<Field, string>>;

/** The register handler answers 400 with one message; put it next to the field it is about. */
function fieldFor400(message: string): Field | null {
  if (/email address/i.test(message)) return 'email';
  if (/^name /i.test(message)) return 'displayName';
  if (/password|characters|common|repeated|email name/i.test(message)) return 'password';
  return null;
}

export default function RegisterPage() {
  const session = useSession();
  const register = useRegister();
  const [params] = useSearchParams();
  const { remaining, start: startWait } = useCountdown();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [passwordTouched, setPasswordTouched] = useState(false);

  const refs = {
    displayName: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  const checks = useMemo(() => passwordChecks(password, email), [password, email]);
  const apiError = register.error instanceof ApiError ? register.error : null;
  const locked = remaining > 0;
  const next = params.get('next');
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login';

  // Map server answers onto the form.
  useEffect(() => {
    if (!apiError) return;
    if (apiError.status === 429) startWait(apiError.retryAfter ?? 60);
    if (apiError.status === 409) {
      setFieldErrors((f) => ({ ...f, email: apiError.message }));
      refs.email.current?.focus();
    }
    if (apiError.status === 400) {
      const field = fieldFor400(apiError.message);
      if (field) {
        setFieldErrors((f) => ({ ...f, [field]: apiError.message }));
        refs[field].current?.focus();
      }
    }
  }, [apiError, startWait]);

  const signupClosed = session.data?.allowSignup === false;
  const offline = session.isError && session.error instanceof ApiError && session.error.isNetwork;
  const busy = register.isPending || register.isSuccess;

  if (signupClosed) {
    return (
      <AuthShell
        documentTitle="Sign up"
        title="Sign-ups are closed"
        subtitle="This SpendWise server isn’t accepting new accounts."
        footer={
          <>
            Already have an account?{' '}
            <Link to={loginHref} className="font-semibold text-accent hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <div className="flex items-start gap-4 rounded-2xl border border-line bg-subtle p-4 text-sm text-muted">
          <ShieldOff className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <p>
            The owner has turned sign-ups off (<code className="font-mono text-xs">ALLOW_SIGNUP=false</code>). Ask them
            for an account, or sign in if you already have one.
          </p>
        </div>
      </AuthShell>
    );
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const n = nameProblem(displayName);
    if (n) errors.displayName = n;
    const e = emailProblem(email);
    if (e) errors.email = e;
    const p = passwordProblem(password, email);
    if (p) errors.password = p;
    if (!confirm) errors.confirm = 'Type your password again.';
    else if (!p && confirm !== password) errors.confirm = 'Passwords do not match.';
    return errors;
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || locked) return;
    setPasswordTouched(true);
    const errors = validate();
    setFieldErrors(errors);
    const first = (['displayName', 'email', 'password', 'confirm'] as const).find((k) => errors[k]);
    if (first) return refs[first].current?.focus();

    register.mutate({ displayName: displayName.trim(), email: email.trim(), password });
  }

  const clear = (key: Field) => setFieldErrors((f) => (f[key] ? { ...f, [key]: undefined } : f));

  let banner: { tone: 'error' | 'offline'; text: string } | null = null;
  if (locked) banner = { tone: 'error', text: `Too many sign-ups from this network. Try again in ${formatWait(remaining)}.` };
  else if (apiError?.isNetwork || (offline && !apiError)) {
    banner = { tone: 'offline', text: 'Can’t reach the SpendWise server. Make sure the backend is running, then try again.' };
  } else if (apiError && apiError.status !== 429 && apiError.status !== 409 && !(apiError.status === 400 && fieldFor400(apiError.message))) {
    banner = { tone: 'error', text: apiError.message };
  } else if (register.error && !apiError) banner = { tone: 'error', text: 'Could not create the account. Please try again.' };

  return (
    <AuthShell
      documentTitle="Sign up"
      title="Create your account"
      subtitle="Your books stay private to your account."
      footer={
        <>
          Already have an account?{' '}
          <Link to={loginHref} className="font-semibold text-accent hover:underline">
            Sign in
          </Link>
        </>
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
          ref={refs.displayName}
          label="Your name"
          icon={UserRound}
          value={displayName}
          onChange={(v) => {
            setDisplayName(v);
            clear('displayName');
          }}
          error={fieldErrors.displayName}
          placeholder="e.g. Priya"
          autoComplete="name"
          maxLength={NAME_MAX}
          autoFocus
          disabled={busy}
        />

        <TextField
          ref={refs.email}
          label="Email"
          type="email"
          icon={Mail}
          value={email}
          onChange={(v) => {
            setEmail(v);
            clear('email');
          }}
          error={
            fieldErrors.email && apiError?.status === 409 ? (
              <>
                {fieldErrors.email}{' '}
                <Link to={loginHref} className="underline">
                  Sign in instead
                </Link>
              </>
            ) : (
              fieldErrors.email
            )
          }
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          disabled={busy}
        />

        <TextField
          ref={refs.password}
          label="Password"
          type="password"
          icon={Lock}
          value={password}
          onChange={(v) => {
            setPassword(v);
            setPasswordTouched(true);
            clear('password');
          }}
          error={fieldErrors.password}
          placeholder="At least 10 characters"
          autoComplete="new-password"
          maxLength={200}
          disabled={busy}
          below={<PasswordChecklist checks={checks} show={passwordTouched || password.length > 0} />}
          hint={!passwordTouched && !password ? 'A few random words works well.' : undefined}
        />

        <TextField
          ref={refs.confirm}
          label="Confirm password"
          type="password"
          icon={KeyRound}
          value={confirm}
          onChange={(v) => {
            setConfirm(v);
            clear('confirm');
          }}
          error={fieldErrors.confirm}
          placeholder="Type it again"
          autoComplete="new-password"
          maxLength={200}
          disabled={busy}
        />

        <div className="pt-2">
          <SubmitButton pending={busy} pendingLabel="Creating your account…" disabled={locked}>
            {locked ? `Try again in ${formatWait(remaining)}` : 'Create account'}
          </SubmitButton>
        </div>
      </form>
    </AuthShell>
  );
}
