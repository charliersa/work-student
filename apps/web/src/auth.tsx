import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeDto } from '@ws/shared';
import { api } from './api';

interface AuthState {
  me: MeDto | null;
  loading: boolean;
  login: (account: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const value: AuthState = {
    me,
    loading,
    login: async (account, password) => setMe(await api.login(account, password)),
    logout: async () => {
      await api.logout();
      setMe(null);
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
