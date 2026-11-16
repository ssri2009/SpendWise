'use strict';
// Scheduled / recurring transactions: create, edit, delete, pause, resume, and the approval queue.
// Every handler works on ctx.user.id only: a schedule or occurrence that belongs to someone else is a plain 404.
const { sendJson } = require('../http');
const v = require('../validate');
const S = require('../schedules');
const RC = require('../recurrence');

module.exports = ({ db, clock }) => {
  const today = () => clock.today();
  /** Bring this user's schedules up to date first, so what they see (and their balance) is current. */
  const catchUp = (userId) => S.runDue(db, userId, today());
  const summary = (r) => ({ posted: r.posted, pending: r.pending, duplicates: r.duplicates, more: r.more });
  const STATUSES = ['active', 'paused', 'finished', 'all'];
  const OCC_STATUSES = ['pending', 'posted', 'skipped', 'all'];

  return {
    'GET /api/schedules': {
      auth: true,
      handler: (ctx) => {
        catchUp(ctx.user.id);
        const status = ctx.query.get('status') || 'all';
        if (!STATUSES.includes(status)) throw v.bad(`status must be one of: ${STATUSES.join(', ')}.`);
        sendJson(ctx.res, 200, { schedules: S.listSchedules(db, ctx.user.id, status), today: today() });
      },
    },

    // Runs everything that is due right now (the same thing that happens automatically on a timer and when you open a page).
    'POST /api/schedules/run': {
      auth: true,
      handler: (ctx) => sendJson(ctx.res, 200, { generated: summary(S.runDue(db, ctx.user.id, today())) }),
    },

    'GET /api/schedules/:id': {
      auth: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        catchUp(ctx.user.id);
        const row = S.getRow(db, ctx.user.id, id);
        const rule = { frequency: row.frequency, n: Number(row.interval_n), unit: row.interval_unit };
        const upcoming = [];
        for (let k = Number(row.occ_index); upcoming.length < 6 && !row.paused; k++) {
          const d = RC.nextDate(row.start_date, rule, row.end_date, k);
          if (d === null) break;
          upcoming.push(d);
        }
        sendJson(ctx.res, 200, {
          schedule: S.toJson(row),
          upcomingDates: upcoming,
          occurrences: S.listOccurrences(db, ctx.user.id, { status: 'all', scheduleId: id, limit: 60 }, today()),
        });
      },
    },

    'POST /api/schedules': {
      auth: true, body: true,
      handler: (ctx) => {
        const id = S.createSchedule(db, ctx.user.id, ctx.body);
        // A start date in the past (or today) is due straight away: "auto" ones are created now, "ask me" ones are queued.
        const generated = S.runDue(db, ctx.user.id, today());
        sendJson(ctx.res, 201, { schedule: S.present(db, ctx.user.id, id), generated: summary(generated) });
      },
    },

    'PATCH /api/schedules/:id': {
      auth: true, body: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        S.updateSchedule(db, ctx.user.id, id, ctx.body, today());
        const generated = S.runDue(db, ctx.user.id, today());
        sendJson(ctx.res, 200, { schedule: S.present(db, ctx.user.id, id), generated: summary(generated) });
      },
    },

    // Deleting a schedule removes the rule and its queue. Transactions it already created stay (they are ordinary transactions).
    'DELETE /api/schedules/:id': {
      auth: true,
      handler: (ctx) => {
        S.deleteSchedule(db, ctx.user.id, v.paramId(ctx));
        sendJson(ctx.res, 200, { ok: true });
      },
    },

    'POST /api/schedules/:id/pause': {
      auth: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        S.pauseSchedule(db, ctx.user.id, id);
        sendJson(ctx.res, 200, { schedule: S.present(db, ctx.user.id, id) });
      },
    },

    // { catchUp?: true } also creates / queues what fell due while it was paused. By default those are skipped.
    'POST /api/schedules/:id/resume': {
      auth: true, body: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        const catchUpFlag = ctx.body.catchUp === undefined ? false : !!v.boolish(ctx.body.catchUp, 'catchUp');
        const r = S.resumeSchedule(db, ctx.user.id, id, { catchUp: catchUpFlag }, today());
        const generated = S.runDue(db, ctx.user.id, today());
        sendJson(ctx.res, 200, { schedule: S.present(db, ctx.user.id, id), skipped: r.skipped, generated: summary(generated) });
      },
    },

    // Pay the next bill early (creates the transaction now; nothing is created again on its due date).
    // { amountMinor?, date?, notes?, cleared? }
    'POST /api/schedules/:id/post-next': {
      auth: true, body: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        S.getRow(db, ctx.user.id, id);
        catchUp(ctx.user.id);
        const r = S.handleNext(db, ctx.user.id, id, { post: true, body: ctx.body, today: today() });
        sendJson(ctx.res, 200, { schedule: S.present(db, ctx.user.id, id), ...r });
      },
    },

    'POST /api/schedules/:id/skip-next': {
      auth: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        S.getRow(db, ctx.user.id, id);
        catchUp(ctx.user.id);
        const r = S.handleNext(db, ctx.user.id, id, { post: false, today: today() });
        sendJson(ctx.res, 200, { schedule: S.present(db, ctx.user.id, id), ...r });
      },
    },

    /* ----- the approval queue ----- */

    'GET /api/schedule-occurrences': {
      auth: true,
      handler: (ctx) => {
        catchUp(ctx.user.id);
        const status = ctx.query.get('status') || 'pending';
        if (!OCC_STATUSES.includes(status)) throw v.bad(`status must be one of: ${OCC_STATUSES.join(', ')}.`);
        const sid = ctx.query.get('schedule');
        const scheduleId = sid ? v.intId(sid, 'schedule') : null;
        const limit = v.clampInt(ctx.query.get('limit'), 1, 500, 200);
        sendJson(ctx.res, 200, { occurrences: S.listOccurrences(db, ctx.user.id, { status, scheduleId, limit }, today()), today: today() });
      },
    },

    // Approve = create the transaction now. Optional { amountMinor, date, notes, cleared } for what you actually paid.
    'POST /api/schedule-occurrences/:id/approve': {
      auth: true, body: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        const r = S.approveOccurrence(db, ctx.user.id, id, ctx.body);
        sendJson(ctx.res, 200, { occurrence: S.occToJson(S.getOcc(db, ctx.user.id, id), today()), ...r });
      },
    },

    'POST /api/schedule-occurrences/:id/skip': {
      auth: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        S.skipOccurrence(db, ctx.user.id, id);
        sendJson(ctx.res, 200, { occurrence: S.occToJson(S.getOcc(db, ctx.user.id, id), today()) });
      },
    },
  };
};
