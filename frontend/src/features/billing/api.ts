import { apiGet, apiPost, apiPut } from '../../shared/api/client';

export type Entitlements = {
  vip: boolean; vip_until: number | null; trials_remaining: number; trial_seconds: number;
  unlimited?: boolean; unlimited_until?: number | null;
  conversation_seconds: number; quicktalk_seconds: number; video_seconds: number; max_session_seconds: number;
  active: { id: string; kind: string; seconds: number; state: string; started_at: number; expires_at: number; unlimited?: boolean } | null;
  grants?: Grant[];
};
export type Grant = { id: number; kind: string; conversation_seconds: number; video_seconds: number; expires_at: number; unlimited?: boolean };
export type Activity = { id: string; kind: string; model: string; seconds: number; trial: boolean; state: string; created_at: number; started_at: number; used_seconds: number; unlimited?: boolean };
export const loadActivity = () => apiGet<{ activity: Activity[] }>('/billing/activity');
export const grantLabel = (kind: string) => ({ free: '免费轻量额度', vip: 'VIP 套餐额度', pack: '购买的加量包', gift: '赠送额度' }[kind] || '账户额度');
export function activityDescription(task: Activity): string {
  if (task.unlimited) {
    if (task.state === 'reserved') return '任务准备中 · VIP 不限总时长';
    if (task.state === 'running') return '进行中 · VIP 不扣减总额度';
    return `使用 ${minutes(task.used_seconds)} · VIP 不扣减总额度`;
  }
  if (task.state === 'reserved') return task.trial ? '已预留 1 次体验，等待开始' : `已预留 ${minutes(task.seconds)}，等待开始`;
  if (task.state === 'running') return '进行中，结束后结算';
  if (task.trial) return task.started_at ? `已使用 1 次体验 · ${minutes(task.used_seconds)}` : '未开始，体验次数已退回';
  return task.used_seconds ? `使用 ${minutes(task.used_seconds)} · 退回 ${minutes(task.seconds - task.used_seconds)}` : '未扣减时长，预留额度已退回';
}
export type Plan = { id: 'vip' | 'pack'; name: string; kind: 'vip' | 'pack'; price_fen: number; conversation_seconds: number; video_seconds: number; max_session_seconds: number; valid_days: number; active: boolean; payment_mode?: 'manual' | 'demo'; unlimited?: boolean };
export function planUsageText(plan: Pick<Plan, 'unlimited' | 'conversation_seconds' | 'video_seconds'>): string {
  return plan.unlimited ? '对话、视频不限总时长' : `对话 ${minutes(plan.conversation_seconds)} · 视频 ${minutes(plan.video_seconds)}`;
}
export type Order = { id: string; user_id: number; phone?: string; amount_fen: number; status: string; plan: Plan; created_at: number; receipt?: string };
export type Usage = { id: number; user_id: number; category: string; model: string; quantities: Record<string, number>; measured: boolean; cost_fen: number | null; created_at: number };
export type Revenue = { amount_fen: number; paid_fen: number; refund_fen: number; paying_users: number; estimated_cost_fen: number; unknown_cost_count: number; usage_count: number };
export type Dashboard = { payment_mode: 'manual' | 'demo'; overview: Revenue; orders: Order[]; plans: Plan[]; usage: Usage[]; users: {id: number; phone: string}[] };
export const loadEntitlements = () => apiGet<Entitlements>('/billing/me');
export const loadPlans = () => apiGet<{ plans: Plan[]; payment_mode: 'manual' | 'demo'; payment_instructions: string }>('/billing/plans');
export const loadOrders = (before?: number) => apiGet<{ orders: Order[] }>(`/billing/orders${before ? `?before=${before}` : ''}`);
export const createOrder = (plan_id: string, request_id: string) => apiPost<Order>('/billing/orders', { plan_id, request_id });
export const cancelOrder = (id: string) => apiPost(`/billing/orders/${id}/cancel`);
export const loadDashboard = (before?: number) => apiGet<Dashboard>(`/admin/billing${before ? `?before=${before}` : ''}`);
export const money = (fen: number | string) => `¥${(Number(fen) / 100).toFixed(2)}`;
export const minutes = (seconds: number) => `${Math.floor(seconds / 60)}分${seconds % 60 ? `${seconds % 60}秒` : ''}`;
export const orderStatus: Record<string, string> = { pending: '待人工核实', paid: '已到账 · 权益已发放', refunded: '已登记全额退款', cancelled: '已取消' };
export function orderStatusLabel(order: Order): string {
  if (order.plan.payment_mode === 'demo') {
    return ({ pending: '演示订单 · 待模拟付款', demo_submitted: '模拟付款完成 · 待管理员确认', paid: '演示开通 · 权益已发放', refunded: '演示权益已撤销', cancelled: '演示订单已取消' } as Record<string, string>)[order.status] || order.status;
  }
  return orderStatus[order.status] || order.status;
}
export function quotaAvailable(account: Entitlements, kind: string): boolean {
  if (account.unlimited && account.vip) return true;
  return kind === 'video' ? account.video_seconds > 0 : kind === 'quicktalk'
    ? account.quicktalk_seconds > 0 || account.trials_remaining > 0 : account.conversation_seconds > 0;
}
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
}

export async function savePlan(plan: Plan): Promise<void> {
  // Use the common client so account and portal headers stay consistent.
  const { id, ...body } = plan;
  await apiPut(`/admin/billing/plans/${id}`, body);
}
