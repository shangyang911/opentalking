import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DemoOrderActions } from '../src/features/billing/DemoOrderActions';
import { orderStatusLabel, type Order } from '../src/features/billing/api';

const demo = { id: 'ord_demo', status: 'pending', plan: { payment_mode: 'demo' } } as Order;

test('demo order labels distinguish simulated approval from real money received', () => {
  assert.equal(orderStatusLabel({ ...demo, status: 'paid' }), '演示开通 · 权益已发放');
  assert.equal(orderStatusLabel({ ...demo, status: 'demo_submitted' }), '模拟付款完成 · 待管理员确认');
  assert.equal(orderStatusLabel({ ...demo, status: 'refunded' }), '演示权益已撤销');
  assert.equal(orderStatusLabel({ ...demo, plan: {} as Order['plan'], status: 'paid' }), '已到账 · 权益已发放');
});

test('demo actions require the enabled mode and the correct portal and order stage', () => {
  const html = (order: Order, admin: boolean, enabled = true) => renderToStaticMarkup(createElement(DemoOrderActions, { order, admin, enabled, busy: false, onAction() {} }));
  assert.match(html(demo, false), /模拟付款/);
  assert.equal(html(demo, true), '');
  const submitted = { ...demo, status: 'demo_submitted' };
  assert.match(html(submitted, true), /确认演示开通/);
  assert.equal(html(submitted, false), '');
  assert.match(html({ ...demo, status: 'paid' }, true), /撤销演示权益/);
  assert.equal(html(demo, false, false), '');
  assert.equal(html({ ...demo, plan: {} as Order['plan'] }, false), '');
});
