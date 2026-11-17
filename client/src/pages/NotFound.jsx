import { Link } from 'react-router-dom';

export default function NotFound() {
  return <div className="app-shell flex min-h-full items-center justify-center px-6 py-24 text-center"><div><p className="text-sm font-semibold uppercase tracking-widest text-brand-500">404</p><h1 className="mt-3 text-3xl font-black">Page not found</h1><p className="mt-2 text-slate-500">The page you requested does not exist.</p><Link to="/" className="mt-6 inline-flex rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white">Back to Home</Link></div></div>;
}
