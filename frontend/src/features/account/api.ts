import { apiDelete, apiGet, apiPost, apiPostForm, apiPut, buildApiUrl } from '../../shared/api/client';
import { accountLabel, type Account } from '../auth/api';

export type Profile = { id: number; phone: string | null; nickname: string; signature: string; created_at: number; avatar_url: string | null };
export const loadProfile = () => apiGet<Profile>('/account/profile');
export const saveProfile = (nickname: string, signature: string) => apiPut<Profile>('/account/profile', { nickname, signature });
export const removeAvatar = () => apiDelete<Profile>('/account/avatar');
export const changePassword = (current_password: string, new_password: string) => apiPost('/account/password', { current_password, new_password });
export function uploadAvatar(blob: Blob): Promise<Profile> {
  const data = new FormData(); data.append('file', blob, 'profile.webp');
  return apiPostForm('/account/avatar', data);
}
export function accountDisplayName(account: Account, profile: Profile | null): string {
  return profile?.id === account.id && profile.nickname ? profile.nickname : accountLabel(account);
}
export function profileAvatarSrc(url: string | null | undefined): string | undefined {
  return url && /^\/account\/avatar\?v=[\d.]+$/.test(url) ? buildApiUrl(url) : undefined;
}
