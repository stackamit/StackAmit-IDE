import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../context/UserAuthContext.jsx', () => ({ useUserAuth: () => ({ user: null, login: vi.fn(), register: vi.fn() }) }));
import AccountAuth from '../AccountAuth.jsx';

describe('account auth navigation', () => {
  it('provides a back-to-site link and login/register navigation', () => { render(<MemoryRouter><AccountAuth /></MemoryRouter>); expect(screen.getByRole('link', { name: /Back to Site/ })).toHaveAttribute('href', '/'); expect(screen.getByRole('link', { name: /Create an account/ })).toHaveAttribute('href', '/account/register'); });
  it('provides login navigation in registration mode', () => { render(<MemoryRouter><AccountAuth registerMode /></MemoryRouter>); expect(screen.getByRole('link', { name: /^Sign in$/ })).toHaveAttribute('href', '/account/login'); });
});
