import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import AiAbout from '../AiAbout.jsx';

vi.mock('../../hooks/useSiteContent.js', () => ({
  useSiteContent: () => ({
    aiDocumentation: {
      published: true,
      title: 'AI guide',
      subtitle: 'Configure AI',
      introduction: 'Guests can use the IDE.',
      cta: { primaryLabel: 'Open IDE', primaryHref: '/ide', secondaryLabel: 'Register', secondaryHref: '/account/register' },
      sections: [
        { id: 'one', title: 'First section', body: 'First body', enabled: true, order: 20, steps: [], examples: [], faqs: [], media: [] },
        { id: 'hidden', title: 'Hidden section', body: 'Do not render', enabled: false, order: 10, steps: [], examples: [], faqs: [], media: [] },
      ],
    },
  }),
}));

describe('AI documentation page', () => {
  test('renders the existing public page with enabled ordered content and CTAs', () => {
    render(<MemoryRouter><AiAbout /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'AI guide' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'First section' })).toBeInTheDocument();
    expect(screen.queryByText('Do not render')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open IDE/ })).toHaveAttribute('href', '/ide');
    expect(screen.getByRole('link', { name: /Register/ })).toHaveAttribute('href', '/account/register');
  });
});
