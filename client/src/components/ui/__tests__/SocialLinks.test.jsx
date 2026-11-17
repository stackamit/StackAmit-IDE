import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SocialLinks from '../SocialLinks.jsx';

describe('SocialLinks', () => {
  it('renders only configured enabled platforms', () => {
    render(<SocialLinks social={{ github: 'https://github.com/stackamit', linkedin: 'https://linkedin.com/company/stackamit' }} />);
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', 'https://github.com/stackamit');
    expect(screen.getByRole('link', { name: 'LinkedIn' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Instagram' })).not.toBeInTheDocument();
  });

  it('renders nothing when all configured platforms are disabled', () => {
    const { container } = render(<SocialLinks social={{ github: 'https://github.com/stackamit' }} socialVisibility={{ github: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('rejects unsafe and non-http links', () => {
    const { container } = render(<SocialLinks social={{ github: 'javascript:alert(1)', youtube: 'mailto:test@example.com' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not render duplicate platform icons for one CMS URL', () => {
    render(<SocialLinks social={{ website: 'https://stackamit.netlify.app', github: 'https://stackamit.netlify.app', linkedin: 'https://stackamit.netlify.app' }} />);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Website' })).toBeInTheDocument();
  });
});
