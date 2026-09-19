import Image from "next/image";

export function AuthBrand() {
  return (
    <div className="flex items-center justify-center gap-3">
      <Image
        src="/drezivo-mark-reference.png"
        alt=""
        aria-hidden="true"
        width={1199}
        height={1312}
        className="h-9 w-auto object-contain"
        priority
      />
      <span className="font-display text-4xl leading-none text-auth-text">Drezivo</span>
    </div>
  );
}
