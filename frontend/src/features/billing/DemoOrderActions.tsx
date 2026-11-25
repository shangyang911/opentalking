import { apiPost } from '../../shared/api/client';
import type { Order } from './api';

export function DemoOrderActions({ order, admin, enabled, busy, onAction }: {
  order: Order; admin: boolean; enabled: boolean; busy: boolean;
  onAction: (operation: () => Promise<unknown>, notice: string) => void;
}) {
  if (!enabled || order.plan.payment_mode !== 'demo') return null;
  const action = !admin && order.status === 'pending'
    ? { path: `/billing/orders/${order.id}/demo-pay`, label: '模拟付款', notice: '模拟付款已提交，请在管理员后台确认演示开通。' }
    : admin && order.status === 'demo_submitted'
      ? { path: `/admin/billing/orders/${order.id}/demo-confirm`, label: '确认演示开通', notice: '演示 VIP 已开通，用户端将自动刷新权益。' }
      : admin && order.status === 'paid'
        ? { path: `/admin/billing/orders/${order.id}/demo-revoke`, label: '撤销演示权益', notice: '演示权益已撤销，可以重新下单演示。' }
        : null;
  if (!action) return null;
  return <button disabled={busy} onClick={() => onAction(() => apiPost(action.path), action.notice)} className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{action.label}</button>;
}
