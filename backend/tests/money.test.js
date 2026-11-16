'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// public/js/money.js is browser ESM; Node detects the syntax, so the very same file is tested.
test('parseMoney turns typed text into exact paise', async () => {
  const { parseMoney } = await import('../public/js/money.js');
  const cases = [
    ['450', 45000], ['450.5', 45050], ['450.50', 45050], ['0.05', 5], ['0.5', 50], ['1', 100],
    ['  1250  ', 125000], ['₹ 99', 9900], ['1,250.50', 125050], ['1,00,000', null], // lakh grouping is not accepted: ask for plain digits
    ['12,5', null],            // a European decimal comma must NOT silently become 125
    ['1,2345', null], ['', null], ['abc', null], ['1.234', null], ['-5', null], ['1e5', null], ['0x10', null],
    ['9999999999.99', 999999999999], ['12345678901', null], ['.5', null], ['5.', null],
  ];
  for (const [input, want] of cases) assert.equal(parseMoney(input), want, JSON.stringify(input));
  // The classic float trap: 0.1 + 0.2 style values stay exact
  assert.equal(parseMoney('19.99'), 1999);
  assert.equal(parseMoney('1.15'), 115);
  assert.equal(parseMoney('4.35'), 435);
  assert.equal(parseMoney('-25000', { allowNegative: true }), -2500000);
  assert.equal(parseMoney('-0.50', { allowNegative: true }), -50);
  assert.equal(parseMoney('- 5', { allowNegative: true }), -500);
});

test('toInput is the inverse of parseMoney for the edit form', async () => {
  const { parseMoney, toInput } = await import('../public/js/money.js');
  for (const minor of [0, 5, 50, 100, 45000, 45050, 125050, 999999999999]) {
    assert.equal(parseMoney(toInput(minor)), minor, String(minor));
  }
  assert.equal(toInput(45050), '450.5');
  assert.equal(toInput(45005), '450.05');
  assert.equal(toInput(-2500000), '-25000');
});

test('makeMoney formats in the user locale without losing paise', async () => {
  const { makeMoney } = await import('../public/js/money.js');
  const m = makeMoney('en-IN', 'INR');
  assert.equal(m.fmt(45000), '₹450');
  assert.equal(m.fmt(45050), '₹450.50');
  assert.equal(m.fmt(-45050), '₹450.50');
  assert.equal(m.fmt(5000000), '₹50,000');
  assert.equal(m.fmt(10000000), '₹1,00,000'); // Indian digit grouping
  assert.equal(m.signed(-45050), '−₹450.50');
  assert.equal(m.signed(5000000), '+₹50,000');
  assert.equal(m.net(-100), '−₹1');
  assert.equal(m.net(100), '₹1');
});
