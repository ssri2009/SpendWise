import { BellRing, CalendarClock, Info, Zap } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { describeGenerated, useCreateSchedule, useUpdateSchedule } from '../../hooks/useSchedules';
import { ApiError } from '../../lib/api';
import { formatDate, type MoneyFormat } from '../../lib/format';
import { parseMoney, toInputValue } from '../../lib/money';
import { addDays, datesBetween, datesFrom, FREQUENCY_OPTIONS, isIsoDate, makeRule, MAX_INTERVAL, UNIT_OPTIONS } from '../../lib/recurrence';
import type { Account, CategoryGroupNode, Payee } from '../../types/api';
import type { Schedule, ScheduleFrequency, ScheduleInput, ScheduleMode, ScheduleUnit } from '../../types/schedules';
import { CONTROL, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';
import { Drawer } from '../ui/Drawer';
import { AccountSelect, CategorySelect, categoryIndex } from '../transactions/pickers';

type Kind = 'expense' | 'income';

interface FormState {
  name: string;
  kind: Kind;
  amountText: string;
  accountId: number | null;
  payee: string;
  categoryId: number | null;
  frequency: ScheduleFrequency;
  intervalText: string;
  unit: ScheduleUnit;
  startDate: string;
  ends: boolean;
  endDate: string;
  mode: ScheduleMode;
  cleared: boolean;
  notes: string;
}

type Field = 'name' | 'amount' | 'account' | 'payee' | 'interval' | 'start' | 'end' | 'notes' | 'form';
type Errors = Partial<Record<Field, string>>;

function initialState(s: Schedule | null, defaults: { accountId: number | null; today: string }): FormState {
  if (!s) {
    return {
      name: '', kind: 'expense', amountText: '', accountId: defaults.accountId, payee: '', categoryId: null,
      frequency: 'monthly', intervalText: '2', unit: 'week', startDate: defaults.today, ends: false, endDate: '',
      mode: 'approval', cleared: false, notes: '',
    };
  }
  return {
    name: s.name,
    kind: s.kind,
    amountText: toInputValue(Math.abs(s.amountMinor)),
    accountId: s.accountId,
    payee: s.payee,
    categoryId: s.categoryId,
    frequency: s.frequency,
    intervalText: String(s.interval),
    unit: s.unit,
    startDate: s.startDate,
    ends: s.endDate !== null,
    endDate: s.endDate ?? '',
    mode: s.mode,
    cleared: s.cleared,
    notes: s.notes ?? '',
  };
}

const KIND_BTN = 'relative flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors';

/**
 * Create (POST /api/schedules) or edit (PATCH /api/schedules/:id) a schedule.
 * The date preview uses a client copy of the server's recurrence maths; the server decides for real.
 */
export function ScheduleFormDrawer({
  schedule,
  accounts,
  groups,
  payees,
  today,
  fmt,
  onClose,
  onSaved,
}: {
  /** null = new schedule. */
  schedule: Schedule | null;
  accounts: Account[];
  groups: CategoryGroupNode[];
  payees: Payee[];
  /** The server's today. */
  today: string;
  fmt: MoneyFormat;
  onClose: () => void;
  onSaved: (message: string, scheduleId: number) => void;
}) {
  const isNew = schedule === null;
  const create = useCreateSchedule();
  const update = useUpdateSchedule();
  const pending = create.isPending || update.isPending;

  const firstOpen = accounts.find((a) => !a.closed)?.id ?? null;
  const [form, setForm] = useState<FormState>(() => initialState(schedule, { accountId: firstOpen, today }));
  const [errors, setErrors] = useState<Errors>({});
  const amountRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = {
    name: useId(), amount: useId(), account: useId(), payee: useId(), list: useId(), cat: useId(), freq: useId(), interval: useId(),
    unit: useId(), start: useId(), end: useId(), notes: useId(), cleared: useId(),
  };

  const cats = useMemo(() => categoryIndex(groups), [groups]);
  const payeeByName = useMemo(() => new Map(payees.map((p) => [p.name.toLowerCase(), p])), [payees]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (Object.keys(e).length ? {} : e));
  };

  const parsedAmount = parseMoney(form.amountText);
  const interval = /^\d{1,4}$/.test(form.intervalText.trim()) ? Number(form.intervalText.trim()) : NaN;
  const rule = makeRule(form.frequency, interval, form.unit);
  const once = form.frequency === 'once';
  const endDate = !once && form.ends && form.endDate ? form.endDate : null;
  const startOk = isIsoDate(form.startDate);

  const ruleChanged =
    !isNew &&
    (form.frequency !== schedule.frequency ||
      form.startDate !== schedule.startDate ||
      (form.frequency === 'custom' && (interval !== schedule.interval || form.unit !== schedule.unit)));

  /** What will happen with these dates, computed the same way the server does. */
  const preview = useMemo(() => {
    if (!rule || !startOk || (endDate && !isIsoDate(endDate)) || (endDate && endDate < form.startDate)) return null;
    // New: anything from the start date up to today is created / queued at once. Edit with a new rule: applies from today on.
    const past = isNew ? datesBetween(form.startDate, rule, endDate, form.startDate, addOne(today), 367) : [];
    // Edit, same timing: carries on from the stored next date (a finished one brought back by a later end date restarts today).
    const from = isNew ? addOne(today) : ruleChanged ? (form.startDate > today ? form.startDate : today) : (schedule.nextDate ?? today);
    const next = datesFrom(form.startDate, rule, endDate, from, 4);
    return { past, next };
  }, [rule, startOk, endDate, form.startDate, isNew, today, ruleChanged, schedule]);

  function onPayeeCommit(name: string) {
    const hit = payeeByName.get(name.trim().toLowerCase());
    if (!hit || !hit.defaultCategoryId || form.categoryId !== null || !cats.has(hit.defaultCategoryId)) return;
    const c = cats.get(hit.defaultCategoryId)!;
    setForm((f) => ({ ...f, categoryId: hit.defaultCategoryId, kind: c.isIncome ? 'income' : f.kind }));
  }

  function onCategory(id: number | null) {
    setForm((f) => ({ ...f, categoryId: id, kind: id !== null && cats.get(id)?.isIncome ? 'income' : f.kind }));
  }

  function validate(): Errors {
    const e: Errors = {};
    const name = form.name.trim();
    const payee = form.payee.trim();
    if (!name && !payee) e.name = 'Give it a name, or fill in the payee.';
    if (name.length > 60) e.name = 'Name must be 60 characters or fewer.';
    if (payee.length > 60) e.payee = 'Payee must be 60 characters or fewer.';
    if (parsedAmount === null || parsedAmount === 0) e.amount = 'Enter an amount like 499 or 12,500.';
    if (form.accountId === null) e.account = 'Pick an account.';
    if (form.frequency === 'custom' && (!Number.isSafeInteger(interval) || interval < 1 || interval > MAX_INTERVAL))
      e.interval = `A whole number from 1 to ${MAX_INTERVAL}.`;
    if (!startOk) e.start = 'Pick a date.';
    if (!once && form.ends) {
      if (!isIsoDate(form.endDate)) e.end = 'Pick an end date, or choose "Never".';
      else if (startOk && form.endDate < form.startDate) e.end = 'The end date cannot be before the start date.';
    }
    if (form.notes.trim().length > 200) e.notes = 'Notes must be 200 characters or fewer.';
    return e;
  }

  function buildInput(): ScheduleInput {
    const input: ScheduleInput = {
      name: form.name.trim() || form.payee.trim(),
      accountId: form.accountId!,
      amountMinor: (form.kind === 'income' ? 1 : -1) * parsedAmount!,
      payee: form.payee.trim(),
      categoryId: form.categoryId,
      notes: form.notes.trim(),
      cleared: form.cleared,
      mode: form.mode,
      frequency: form.frequency,
      startDate: form.startDate,
      endDate,
    };
    if (form.frequency === 'custom') {
      input.interval = interval;
      input.unit = form.unit;
    }
    return input;
  }

  function fail(err: unknown) {
    setErrors({ form: err instanceof ApiError ? err.message : 'Could not save. Please try again.' });
  }

  function submit() {
    if (pending) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      if (e.name) nameRef.current?.focus();
      else if (e.amount) amountRef.current?.focus();
      return;
    }
    const input = buildInput();
    if (isNew) {
      create.mutate(input, {
        onSuccess: (r) => {
          const extra = describeGenerated(r.generated);
          onSaved(`Created "${r.schedule.name}".${extra ? ` ${extra}` : ''}`, r.schedule.id);
          onClose();
        },
        onError: fail,
      });
    } else {
      update.mutate(
        { id: schedule.id, patch: input },
        {
          onSuccess: (r) => {
            const extra = describeGenerated(r.generated);
            onSaved(`Saved "${r.schedule.name}".${extra ? ` ${extra}` : ''}`, r.schedule.id);
            onClose();
          },
          onError: fail,
        },
      );
    }
  }

  const payeeOptions = payees.filter((p) => !p.archived).slice(0, 400);
  const locale = fmt.locale;
  const short = (d: string) => formatDate(d, locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const onlyToday = !!preview && preview.past.length === 1 && preview.past[0] === today;

  return (
    <Drawer
      title={isNew ? 'New schedule' : 'Edit schedule'}
      description={isNew ? 'A bill, subscription, salary or anything else that repeats. Ctrl + Enter saves.' : `${schedule.frequencyLabel} · ${schedule.accountName}`}
      onClose={onClose}
      onSubmit={submit}
      width="lg"
      footer={
        <>
          <GhostButton onClick={onClose} disabled={pending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={pending}>{pending ? 'Saving…' : isNew ? 'Create schedule' : 'Save changes'}</PrimaryButton>
        </>
      }
    >
      <div className="space-y-5">
        {errors.form && (
          <p role="alert" className="rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
            {errors.form}
          </p>
        )}

        <div role="group" aria-label="Direction" className="flex rounded-xl bg-subtle p-1">
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={form.kind === k}
              onClick={() => set('kind', k)}
              className={`${KIND_BTN} ${
                form.kind === k ? (k === 'expense' ? 'bg-expense text-white shadow-sm' : 'bg-income text-[#04301f] shadow-sm') : 'text-muted hover:text-fg'
              }`}
            >
              {k === 'expense' ? 'Expense' : 'Income'}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <DialogField label="Name" htmlFor={ids.name} error={errors.name} hint="Leave empty to use the payee.">
            <input
              ref={nameRef}
              id={ids.name}
              className={CONTROL}
              maxLength={60}
              autoComplete="off"
              placeholder="e.g. Rent, Netflix, Salary"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              autoFocus
            />
          </DialogField>
          <DialogField label="Amount" htmlFor={ids.amount} error={errors.amount}>
            <input
              ref={amountRef}
              id={ids.amount}
              className={`${CONTROL} text-right text-base font-semibold tabular-nums`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={form.amountText}
              onChange={(e) => set('amountText', e.target.value)}
              aria-invalid={errors.amount ? true : undefined}
            />
          </DialogField>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <DialogField label="Account" htmlFor={ids.account} error={errors.account}>
            <AccountSelect id={ids.account} accounts={accounts} value={form.accountId} onChange={(id) => set('accountId', id)} keep={schedule?.accountId} />
          </DialogField>
          <DialogField label="Payee" htmlFor={ids.payee} error={errors.payee}>
            <input
              id={ids.payee}
              list={ids.list}
              className={CONTROL}
              maxLength={60}
              autoComplete="off"
              placeholder="Optional"
              value={form.payee}
              onChange={(e) => set('payee', e.target.value)}
              onBlur={(e) => onPayeeCommit(e.target.value)}
            />
            <datalist id={ids.list}>
              {payeeOptions.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </DialogField>
        </div>

        <DialogField label="Category" htmlFor={ids.cat} hint="Empty uses the payee's default category, then your rules.">
          <CategorySelect id={ids.cat} groups={groups} value={form.categoryId} onChange={onCategory} keep={form.categoryId} />
        </DialogField>

        {/* ---------- when ---------- */}
        <fieldset className="space-y-4 rounded-2xl border border-line p-4">
          <legend className="flex items-center gap-1.5 px-1.5 text-sm font-semibold">
            <CalendarClock className="size-4 text-accent" aria-hidden /> When
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <DialogField label="Repeats" htmlFor={ids.freq}>
              <select id={ids.freq} className={CONTROL} value={form.frequency} onChange={(e) => set('frequency', e.target.value as ScheduleFrequency)}>
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id} className="bg-elevated text-fg">
                    {o.label}
                  </option>
                ))}
              </select>
            </DialogField>
            <DialogField label={once ? 'Date' : 'First date'} htmlFor={ids.start} error={errors.start}>
              <input
                id={ids.start}
                type="date"
                className={CONTROL}
                value={form.startDate}
                onChange={(e) => set('startDate', e.target.value)}
                aria-invalid={errors.start ? true : undefined}
              />
            </DialogField>
          </div>

          {form.frequency === 'custom' && (
            <div>
              <span className="mb-1.5 block text-sm font-medium" id={`${ids.interval}-l`}>
                Every
              </span>
              <div className="flex gap-2" role="group" aria-labelledby={`${ids.interval}-l`}>
                <input
                  id={ids.interval}
                  aria-label="Interval"
                  inputMode="numeric"
                  className={`${CONTROL} w-24 text-right tabular-nums`}
                  value={form.intervalText}
                  onChange={(e) => set('intervalText', e.target.value)}
                  aria-invalid={errors.interval ? true : undefined}
                />
                <select id={ids.unit} aria-label="Unit" className={CONTROL} value={form.unit} onChange={(e) => set('unit', e.target.value as ScheduleUnit)}>
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u.id} value={u.id} className="bg-elevated text-fg">
                      {interval === 1 ? u.one : u.many}
                    </option>
                  ))}
                </select>
              </div>
              {errors.interval && (
                <p role="alert" className="pt-1.5 text-xs font-medium text-expense">
                  {errors.interval}
                </p>
              )}
            </div>
          )}

          {!once && (
            <div>
              <span className="mb-1.5 block text-sm font-medium">Ends</span>
              <div className="flex flex-wrap items-center gap-3">
                <div role="group" aria-label="Ends" className="flex rounded-xl bg-subtle p-1">
                  {[
                    { v: false, label: 'Never' },
                    { v: true, label: 'On a date' },
                  ].map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      aria-pressed={form.ends === o.v}
                      onClick={() => set('ends', o.v)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        form.ends === o.v ? 'bg-elevated text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {form.ends && (
                  <input
                    id={ids.end}
                    type="date"
                    aria-label="End date"
                    className={`${CONTROL} w-auto flex-1`}
                    min={form.startDate || undefined}
                    value={form.endDate}
                    onChange={(e) => set('endDate', e.target.value)}
                    aria-invalid={errors.end ? true : undefined}
                  />
                )}
              </div>
              {errors.end && (
                <p role="alert" className="pt-1.5 text-xs font-medium text-expense">
                  {errors.end}
                </p>
              )}
            </div>
          )}

          {preview && (
            <div className="space-y-2 rounded-xl bg-subtle px-3.5 py-3 text-sm" aria-live="polite">
              {preview.next.length > 0 ? (
                <p>
                  <span className="text-muted">{preview.past.length ? 'Then: ' : isNew || ruleChanged ? 'Next dates: ' : 'Coming up: '}</span>
                  <span className="font-medium">{preview.next.map(short).join(' · ')}</span>
                  {!once && preview.next.length === 4 && <span className="text-muted"> …</span>}
                </p>
              ) : (
                preview.past.length === 0 && <p className="text-muted">No dates left with these settings: it will be finished.</p>
              )}
              {preview.past.length > 0 && (
                <p className={`flex items-start gap-2 ${onlyToday ? 'text-muted' : 'text-warning'}`}>
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    {onlyToday
                      ? 'The first one is due today, so it '
                      : `${preview.past.length > 366 ? 'More than 366' : preview.past.length} dates from ${short(preview.past[0])} up to today are already due. They `}
                    {form.mode === 'auto'
                      ? `will be created as ${onlyToday ? 'a transaction' : 'transactions'} as soon as you save.`
                      : `will wait for your approval as soon as you save.`}
                  </span>
                </p>
              )}
              {ruleChanged && (
                <p className="flex items-start gap-2 text-muted">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  New timing applies from today on. Nothing already handled repeats, and missed past dates are not filled in.
                </p>
              )}
            </div>
          )}
        </fieldset>

        {/* ---------- how ---------- */}
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">When it's due</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                { id: 'approval', icon: BellRing, title: 'Ask me first', text: 'Waits in your approval queue. Nothing touches your balance until you approve it.' },
                { id: 'auto', icon: Zap, title: 'Post automatically', text: 'Creates the transaction on its date, through your rules like any other.' },
              ] as const
            ).map((o) => {
              const Icon = o.icon;
              const on = form.mode === o.id;
              return (
                <label
                  key={o.id}
                  className={`flex cursor-pointer gap-3 rounded-2xl border p-3.5 transition-colors ${
                    on ? 'border-accent bg-accent/8 ring-2 ring-accent/20' : 'border-line hover:border-accent/40 hover:bg-subtle'
                  }`}
                >
                  <input type="radio" name="sw-schedule-mode" value={o.id} checked={on} onChange={() => set('mode', o.id)} className="sr-only" />
                  <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${on ? 'bg-accent text-accent-fg' : 'bg-subtle text-muted'}`}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{o.title}</span>
                    <span className="block text-xs text-muted">{o.text}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <DialogField label="Notes" htmlFor={ids.notes} error={errors.notes}>
          <textarea
            id={ids.notes}
            rows={2}
            maxLength={200}
            className={`${CONTROL} h-auto py-2.5`}
            placeholder="Copied onto each transaction it creates"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </DialogField>

        <label htmlFor={ids.cleared} className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            id={ids.cleared}
            type="checkbox"
            checked={form.cleared}
            onChange={(e) => set('cleared', e.target.checked)}
            className="size-4 accent-[var(--sw-accent)]"
          />
          Mark the transactions it creates as cleared
        </label>

      </div>
    </Drawer>
  );
}

const addOne = (iso: string) => addDays(iso, 1);
