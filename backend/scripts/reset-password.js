'use strict';
// Usage: npm run user:reset-password -- you@example.com
// (For automation you can pass the new password in NEW_PASSWORD instead of typing it.)
const readline = require('node:readline');
const { loadConfig } = require('../server/config');
const { openDb } = require('../server/db');
const { hashPassword, passwordProblem } = require('../server/security');
const { destroyUserSessions } = require('../server/sessions');

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function (s) {
      if (s.includes(question)) rl.output.write(s);
      else rl.output.write('*');
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run user:reset-password -- you@example.com');
    process.exit(1);
  }
  const config = loadConfig();
  const db = openDb(config.dbFile);
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }
  const password = process.env.NEW_PASSWORD || (await askHidden('New password: '));
  const problem = passwordProblem(password, email);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  const hash = await hashPassword(password, config.scryptN);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  destroyUserSessions(db, user.id);
  console.log('Password updated. All existing sessions for this user were signed out.');
  db.close();
})();
