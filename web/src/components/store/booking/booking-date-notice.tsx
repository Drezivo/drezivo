import type { DateRangeNotice } from './availability-calendar';

export function BookingDateNotice({
  notice,
  maxDays,
  facebookUrl,
  instagramUrl,
}: {
  notice: DateRangeNotice;
  maxDays: number;
  facebookUrl: string | null;
  instagramUrl: string | null;
}) {
  const socials = [
    facebookUrl ? { label: 'Facebook', href: facebookUrl } : null,
    instagramUrl ? { label: 'Instagram', href: instagramUrl } : null,
  ].filter((social): social is { label: string; href: string } => social !== null);

  return (
    <div>
      <p role="alert" className="text-sm text-[#b3311f]">
        {notice.message}
      </p>
      {notice.reason === 'max_rental_days' && socials.length > 0 ? (
        <p className="mt-2 text-sm leading-5 text-sf-muted">
          Message us on{' '}
          {socials.map((social, index) => (
            <span key={social.href}>
              {index > 0 ? ' or ' : null}
              <a
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-sf-ink"
              >
                {social.label}
              </a>
            </span>
          ))}{' '}
          if you need to rent for more than {maxDays} day{maxDays === 1 ? '' : 's'}.
        </p>
      ) : null}
    </div>
  );
}
