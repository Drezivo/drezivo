import Image from "next/image";

export function AuthBrand() {
  return (
    <div className="flex items-center justify-center gap-3">
      <Image
        src="/brand/drezivo-mark.png"
        alt=""
        aria-hidden="true"
        width={497}
        height={600}
        className="h-9 w-auto object-contain"
        priority
      />
      <span className="font-display text-4xl leading-none text-auth-text">Drezivo</span>
    </div>
  );
}
