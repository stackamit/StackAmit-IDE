import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const auth = vi.hoisted(() => ({ current: { user: null, loading: false } }));
vi.mock('../../context/UserAuthContext.jsx', () => ({ useUserAuth: () => auth.current }));
import UserProtectedRoute from '../UserProtectedRoute.jsx';

function renderRoute() {
  return render(<MemoryRouter initialEntries={['/account/dashboard']}><Routes><Route path="/account/dashboard" element={<UserProtectedRoute><div>dashboard content</div></UserProtectedRoute>} /><Route path="/account/login" element={<div>login screen</div>} /></Routes></MemoryRouter>);
}

describe('UserProtectedRoute', () => {
  it('redirects unauthenticated users to account login', () => { auth.current = { user: null, loading: false }; renderRoute(); expect(screen.getByText('login screen')).toBeInTheDocument(); });
  it('renders dashboard content for an authenticated end user', () => { auth.current = { user: { id: 'u1' }, loading: false }; renderRoute(); expect(screen.getByText('dashboard content')).toBeInTheDocument(); });
  it('shows a loading state while session validation is pending', () => { auth.current = { user: null, loading: true }; renderRoute(); expect(screen.queryByText('login screen')).not.toBeInTheDocument(); });
});
