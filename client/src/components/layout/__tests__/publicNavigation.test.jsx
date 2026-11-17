import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const authState = vi.hoisted(() => ({ user: null }));
vi.mock('../../../hooks/useSiteContent.js', () => ({ useSiteContent: () => ({ branding: { name: 'StackAmit IDE', tagline: 'Code. Compile. Create.', description: 'A powerful online IDE for developers.', logoUrl: '' }, navigation: { links: [{ id: 'home', label: 'Home', href: '/', enabled: true, order: 1 }] }, footer: { copyright: 'All rights reserved.', columns: [{ id: 'one', title: 'Product', links: [{ id: 'home', label: 'Home', href: '/', enabled: true, order: 1 }, { id: 'download', label: 'Download', href: '/download', enabled: true, order: 2 }] }, { id: 'two', title: 'Resources', links: [{ id: 'about', label: 'About', href: '/about', enabled: true, order: 1 }, { id: 'privacy', label: 'Privacy Policy', href: '/privacy-policy', enabled: true, order: 2 }] }, { id: 'three', title: 'Community & Social', links: [] }] }, social: { github: 'https://github.com/stackamit' }, socialVisibility: {} }) }));
vi.mock('../../../context/UserAuthContext.jsx', () => ({ useUserAuth: () => ({ user: authState.user, logout: vi.fn() }) }));
import SiteHeader from '../SiteHeader.jsx';
import SiteFooter from '../SiteFooter.jsx';

describe('public navigation', () => {
  it('renders CMS header links and guest account actions', () => { render(<MemoryRouter><SiteHeader /></MemoryRouter>); expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument(); expect(screen.getByRole('link', { name: /Login/ })).toHaveAttribute('href', '/account/login'); expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/account/register'); });
  it('keeps the footer at exactly three desktop columns and two mobile grid columns', () => { const { container } = render(<MemoryRouter><SiteFooter /></MemoryRouter>); const mainGrid = container.querySelector('section[aria-label="Brand and social links"]')?.parentElement; expect(mainGrid?.querySelectorAll(':scope > nav')).toHaveLength(2); expect(container.querySelector('.grid-cols-2')).toBeInTheDocument(); expect(container.querySelector('[class*="md:grid-cols-"]')).toBeInTheDocument(); });
  it('places configured social links in the brand column', () => { render(<MemoryRouter><SiteFooter /></MemoryRouter>); const socialLink = screen.getByRole('link', { name: 'GitHub' }); expect(socialLink.closest('section')).toHaveAttribute('aria-label', 'Brand and social links'); });
  it('renders the Download route from CMS footer content', () => { render(<MemoryRouter><SiteFooter /></MemoryRouter>); expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/download'); });
  it('hides login and register links for authenticated users and shows dashboard', () => { authState.user = { id: 'user-1', email: 'user@example.com' }; render(<MemoryRouter><SiteFooter /></MemoryRouter>); expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: 'Register' })).not.toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/account/dashboard'); authState.user = null; });
});
