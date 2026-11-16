/* ---------------------------------------------------------------------
   Client-side checks that mirror the server exactly, so most problems are
   caught before a request (and before using up a rate-limit attempt).
   The server stays the authority: its messages are shown when it rejects.

   Sources: EMAIL_RE and the register handler in server/app.js,
   passwordProblem() and COMMON in server/security.js.
   --------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const COMMON = new Set([
  'password123', 'password1234', 'password12345', '1234567890', '12345678910', 'qwertyuiop',
  'qwerty12345', '0123456789', '9876543210', 'letmein1234', 'welcome1234', 'admin12345',
  'iloveyou123', 'abcdefghij', '1q2w3e4r5t', 'passw0rd123', 'changeme123', 'spendwise123',
  '1234512345', 'administrator', 'qwertyuiop123', 'password!23', 'abcd123456', 'football123',
]);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const NAME_MAX = 40;

/** server/app.js normEmail(). */
export const normEmail = (value: string) => value.trim().toLowerCase();

export function emailProblem(value: string): string | null {
  const email = normEmail(value);
  if (!email) return 'Enter your email address.';
  if (!EMAIL_RE.test(email) || email.length > 254) return 'Enter a valid email address.';
  return null;
}

export function nameProblem(value: string): string | null {
  const name = value.trim();
  if (!name) return 'Enter your name.';
  if (name.length > NAME_MAX) return `Name must be 1 to ${NAME_MAX} characters.`;
  return null;
}

function emailLocalPart(email: string) {
  return normEmail(email).split('@')[0] ?? '';
}

/** Same order and wording as passwordProblem() in server/security.js. */
export function passwordProblem(password: string, email: string): string | null {
  if (!password) return 'Password is required.';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Password is too long (max ${PASSWORD_MAX} characters).`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Pick something harder to guess.';
  if (/^(.)\1+$/.test(password)) return 'Password cannot be one repeated character.';
  const local = emailLocalPart(email);
  if (local.length >= 4 && lower.includes(local)) return 'Password should not contain your email name.';
  return null;
}

export interface PasswordCheck {
  id: string;
  label: string;
  ok: boolean;
}

/** The live checklist shown under the new-password field. */
export function passwordChecks(password: string, email: string): PasswordCheck[] {
  const lower = password.toLowerCase();
  const local = emailLocalPart(email);
  return [
    {
      id: 'length',
      label: `At least ${PASSWORD_MIN} characters`,
      ok: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
    },
    {
      id: 'common',
      label: 'Not a common password',
      ok: password.length > 0 && !COMMON.has(lower) && !/^(.)\1+$/.test(password),
    },
    {
      id: 'email',
      label: 'Does not contain your email name',
      ok: password.length > 0 && !(local.length >= 4 && lower.includes(local)),
    },
  ];
}
