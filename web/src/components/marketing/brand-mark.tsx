import Image from 'next/image';

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <Image
      aria-hidden="true"
      src="/marketing/drezivo-mark-reference.png"
      alt=""
      width={560}
      height={620}
      className={`mix-blend-multiply object-contain ${className}`}
    />
  );
}
