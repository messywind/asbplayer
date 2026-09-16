import React, { createContext, useContext } from 'react';
import type { AccountUser, ArchiveEpisode } from '@project/common/app/services/account-api';

export interface AccountContextValue {
    user: AccountUser;
    activeEpisode?: ArchiveEpisode;
    setActiveEpisode: (episode: ArchiveEpisode | undefined) => void;
    refreshUser: () => Promise<void>;
    logout: () => Promise<void>;
}

export const AccountContext = createContext<AccountContextValue | undefined>(undefined);

export function useAccount(): AccountContextValue | undefined {
    return useContext(AccountContext);
}

export function AccountProvider({ value, children }: { value: AccountContextValue; children: React.ReactNode }) {
    return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
