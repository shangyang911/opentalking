import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { loadEntitlements, quotaAvailable, type Entitlements } from './api';

export function useMembership(enabled: boolean, busy: boolean) {
  const [account, setAccount] = useState<Entitlements | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!enabled) return null;
    try {
      const next = await loadEntitlements(); setAccount(next); setError(''); return next;
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 503) { setAccount(null); }
      setError(reason instanceof Error ? reason.message : '会员信息读取失败');
      return null;
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const required = () => { setOpen(true); void refresh(); };
    const focus = () => { void refresh(); };
    window.addEventListener('opentalking:quota-required', required);
    window.addEventListener('focus', focus);
    const timer = setInterval(focus, 30000);
    return () => { clearInterval(timer); window.removeEventListener('opentalking:quota-required', required); window.removeEventListener('focus', focus); };
  }, [enabled, refresh, busy]);
  const check = useCallback(async (kind: string) => {
    if (!enabled) return true;
    const next = await refresh();
    if (!next) { setOpen(true); return false; }
    if (!quotaAvailable(next, kind)) { setOpen(true); return false; }
    return true;
  }, [enabled, refresh]);
  return { account, open, setOpen, error, refresh, check };
}
