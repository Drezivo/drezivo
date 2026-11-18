import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createElement, type ComponentProps } from 'react';

vi.mock('@/components/store/storefront-media-image', () => ({
  StorefrontMediaImage: (props: ComponentProps<'img'>) => createElement('img', props),
}));

import { PolicyImages } from '@/components/store/policy-images';

describe('rental policy images', () => {
  it('keeps policy pages ordered, uncropped and linked to their full-size originals', () => {
    render(<PolicyImages urls={['/first.jpg', '/second.jpg']} shopName="Shop" />);
    const images = screen.getAllByRole('img');
    expect(images.map((image) => image.getAttribute('alt'))).toEqual([
      'Shop rental terms, page 1 of 2', 'Shop rental terms, page 2 of 2',
    ]);
    expect(images[0]?.className).toContain('max-h-[65svh]');
    expect(images[0]?.className).not.toContain('mx-auto');
    expect(images[0]?.closest('a')?.className).not.toContain('mx-auto');
    expect(images[0]?.className).toContain('object-contain');
    expect(images[0]?.closest('a')?.getAttribute('href')).toBe('/first.jpg');
    expect(images[1]?.closest('a')?.getAttribute('href')).toBe('/second.jpg');
  });
});
