import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookingDateNotice } from '@/components/store/booking/booking-date-notice';

describe('booking date notice', () => {
  it('keeps the max-rental warning and adds configured social links with the configured limit', () => {
    render(
      <BookingDateNotice
        notice={{ reason: 'max_rental_days', message: 'The longest rental is 7 days.' }}
        maxDays={7}
        facebookUrl="https://www.facebook.com/rental-shop"
        instagramUrl="https://www.instagram.com/rental-shop/"
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe('The longest rental is 7 days.');
    expect(screen.getByRole('link', { name: 'Facebook' }).getAttribute('href')).toBe(
      'https://www.facebook.com/rental-shop',
    );
    expect(screen.getByRole('link', { name: 'Instagram' }).getAttribute('href')).toBe(
      'https://www.instagram.com/rental-shop/',
    );
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            'Message us on Facebook or Instagram if you need to rent for more than 7 days.',
      ),
    ).toBeTruthy();
  });

  it('shows only the social channel configured by the storefront', () => {
    render(
      <BookingDateNotice
        notice={{ reason: 'max_rental_days', message: 'The longest rental is 5 days.' }}
        maxDays={5}
        facebookUrl={null}
        instagramUrl="https://www.instagram.com/rental-shop/"
      />,
    );

    expect(screen.getByRole('link', { name: 'Instagram' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Facebook' })).toBeNull();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            'Message us on Instagram if you need to rent for more than 5 days.',
      ),
    ).toBeTruthy();
  });

  it('does not show the social prompt when no channels are configured or the notice is unrelated', () => {
    const { rerender } = render(
      <BookingDateNotice
        notice={{ reason: 'max_rental_days', message: 'The longest rental is 7 days.' }}
        maxDays={7}
        facebookUrl={null}
        instagramUrl={null}
      />,
    );

    expect(screen.queryByText(/Message us on/)).toBeNull();

    rerender(
      <BookingDateNotice
        notice={{ reason: 'other', message: 'The shop is closed on Sunday.' }}
        maxDays={7}
        facebookUrl="https://www.facebook.com/rental-shop"
        instagramUrl="https://www.instagram.com/rental-shop/"
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe('The shop is closed on Sunday.');
    expect(screen.queryByText(/Message us on/)).toBeNull();
  });
});
