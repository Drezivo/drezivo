'use client';

import { useEffect, useRef, useState } from 'react';

/** A decorative duplicate that fits the store name to the width of the footer. */
export function FooterWordmark({ name }: { name: string }) {
  const container = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<number | null>(null);

  useEffect(() => {
    const element = container.current;
    const text = measure.current;
    if (!element || !text) return;
    let active = true;
    const fit = () => {
      if (active && text.offsetWidth > 0) setSize((element.clientWidth / text.offsetWidth) * 100);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(element);
    void document.fonts?.ready.then(fit);
    fit();
    return () => { active = false; observer?.disconnect(); };
  }, [name]);

  return (
    <div ref={container} aria-hidden="true" className="relative w-full overflow-hidden font-sf-display uppercase leading-none">
      <span ref={measure} className="pointer-events-none absolute invisible whitespace-nowrap text-[100px]">{name}</span>
      <span className="block whitespace-nowrap opacity-15" style={{ fontSize: size === null ? '1rem' : `${size}px`, visibility: size === null ? 'hidden' : 'visible' }}>{name}</span>
    </div>
  );
}


