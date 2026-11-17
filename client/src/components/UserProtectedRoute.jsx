import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useUserAuth } from '../context/UserAuthContext.jsx';

export default function UserProtectedRoute({ children }) {
  const { user, loading } = useUserAuth();
  const location = useLocation();
  if (loading) return <div className="app-shell flex min-h-full items-center justify-center text-slate-500"><Loader2 className="animate-spin" size={24} /></div>;
  if (!user) return <Navigate to="/account/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return children;
}
