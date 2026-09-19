export function AuthBrand() {
  return (
    <div className="flex items-center justify-center gap-3">
      <svg aria-hidden="true" className="h-10 w-10 text-auth-gold" viewBox="0 0 64 64" fill="none">
        <path
          d="M32 6c-1.3 8.7-8.6 13.8-13.2 19.5C14.1 32.2 13.8 42.4 21 48.1c-2.8-7.3-.2-13.3 4.2-17.8 2.8-2.9 5.6-6.1 6.8-10.1 2.6 6.8 7.2 10.4 8.1 16.4.7 4.7-1.1 8.3-4.2 11.5 8.7-3.2 13.1-10.2 11.6-18.3-1-5.6-5.1-10-8.4-14.8C36.7 11.5 34.2 8.2 32 6Z"
          fill="currentColor"
        />
        <path
          d="M28.4 29.4c-4.1 5.1-6.2 10.1-2.2 16.3 3.4 5.3 8.9 5.1 12.5 1.9-3.6.2-6.9-1.8-7.9-5.2-.9-3.1.5-7.3-2.4-13Z"
          fill="var(--color-auth-panel)"
        />
      </svg>
      <span className="font-display text-4xl leading-none text-auth-text">Drezivo</span>
    </div>
  );
}
