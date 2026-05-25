import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '../cloudbase';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'authed' | 'unauthed'>('loading');

  useEffect(() => {
    auth.getSession().then(({ data }) => {
      setStatus(data?.session && !data.session.user?.is_anonymous ? 'authed' : 'unauthed');
    });
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (status === 'unauthed') return <Navigate to="/login" replace />;
  return <>{children}</>;
}
