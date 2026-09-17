import type { SubtitleAnalysis } from '@project/common/llm-analysis';

export interface AccountUser {
    id: number;
    username: string;
    role: 'admin' | 'user';
    hasApiKey: boolean;
    createdAt?: string;
}

export interface AnimeSpace {
    id: number;
    name: string;
    episodeCount: number;
    analysisCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface ArchiveEpisode {
    id: number;
    spaceId: number;
    spaceName: string;
    label: string;
    mediaFileName?: string;
    analysisCount?: number;
    updatedAt?: string;
}

export interface AnimeSpaceWithEpisodes extends AnimeSpace {
    episodes: ArchiveEpisode[];
}

export interface InviteSummary {
    id: number;
    maxUses: number;
    uses: number;
    expiresAt?: string;
    disabled: number;
    createdAt: string;
    createdBy: string;
}

export interface UsageSummary {
    requests: number;
    apiCalls: number;
    cacheHits: number;
    apiCalls30d: number;
    lastUsedAt?: string;
}

export interface PublicMember {
    id: number;
    username: string;
    role: 'admin' | 'user';
    createdAt: string;
    spaceCount: number;
    episodeCount: number;
    analysisCount: number;
    requests: number;
    apiCalls: number;
    cacheHits: number;
    lastUsedAt?: string;
    spaces: AnimeSpace[];
}

export interface AdminUser extends PublicMember {
    disabled: boolean;
    hasApiKey: boolean;
}

export class AccountApiError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = 'AccountApiError';
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
        ...init,
        credentials: 'same-origin',
        headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    });
    if (!response.ok) {
        let message = `Request failed (${response.status})`;
        try {
            message = ((await response.json()) as { error?: string }).error || message;
        } catch {
            // Keep the status-based fallback.
        }
        throw new AccountApiError(message, response.status);
    }
    return (await response.json()) as T;
}

export const accountApi = {
    me: () => request<{ user: AccountUser }>('/api/auth/me'),
    login: (username: string, password: string) =>
        request<{ user: AccountUser }>('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        }),
    register: (username: string, password: string, inviteCode: string) =>
        request<{ user: AccountUser }>('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ username, password, inviteCode }),
        }),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' }),
    communityUsers: () => request<{ users: PublicMember[] }>('/api/community/users'),
    usage: () => request<{ usage: UsageSummary }>('/api/account/usage'),
    changePassword: (currentPassword: string, newPassword: string) =>
        request<{ ok: boolean }>('/api/account/password', {
            method: 'PUT',
            body: JSON.stringify({ currentPassword, newPassword }),
        }),
    saveApiKey: (apiKey: string) =>
        request<{ configured: boolean }>('/api/account/api-key', {
            method: 'PUT',
            body: JSON.stringify({ apiKey }),
        }),
    removeApiKey: () => request<{ configured: boolean }>('/api/account/api-key', { method: 'DELETE' }),
    spaces: () => request<{ spaces: AnimeSpace[] }>('/api/spaces'),
    createSpace: (name: string) =>
        request<{ space: AnimeSpace }>('/api/spaces', { method: 'POST', body: JSON.stringify({ name }) }),
    deleteSpace: (spaceId: number) =>
        request<{ ok: boolean }>(`/api/spaces/${encodeURIComponent(spaceId)}`, { method: 'DELETE' }),
    createEpisode: (spaceId: number, label: string, mediaFileName?: string) =>
        request<{ episode: ArchiveEpisode }>('/api/episodes', {
            method: 'POST',
            body: JSON.stringify({ spaceId, label, mediaFileName }),
        }),
    deleteEpisode: (episodeId: number) =>
        request<{ ok: boolean }>(`/api/episodes/${encodeURIComponent(episodeId)}`, { method: 'DELETE' }),
    library: () => request<{ spaces: AnimeSpaceWithEpisodes[] }>('/api/library'),
    episode: (episodeId: number) =>
        request<ArchiveEpisode & { count: number; analyses: Record<string, SubtitleAnalysis> }>(
            `/api/episode?episodeId=${encodeURIComponent(episodeId)}`
        ),
    invites: () => request<{ invites: InviteSummary[] }>('/api/admin/invites'),
    createInvite: (maxUses: number, expiresInDays: number) =>
        request<{ invite: InviteSummary & { code: string } }>('/api/admin/invites', {
            method: 'POST',
            body: JSON.stringify({ maxUses, expiresInDays }),
        }),
    disableInvite: (id: number) => request<{ ok: boolean }>(`/api/admin/invites/${id}`, { method: 'DELETE' }),
    adminUsers: () => request<{ users: AdminUser[] }>('/api/admin/users'),
    createUser: (username: string, password: string, role: 'admin' | 'user') =>
        request<{ user: AdminUser }>('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, role }),
        }),
    updateUser: (id: number, input: { username: string; role: 'admin' | 'user'; disabled: boolean }) =>
        request<{ user: AdminUser }>(`/api/admin/users/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(input),
        }),
    resetUserPassword: (id: number, password: string) =>
        request<{ ok: boolean }>(`/api/admin/users/${id}/password`, {
            method: 'PUT',
            body: JSON.stringify({ password }),
        }),
    deleteUser: (id: number) => request<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'DELETE' }),
};
