// The in-game Sharp Eyes skill icon (classic art), shipped as the brand mark so
// the header matches the favicon (app/icon.png) exactly.
//
// The 32x32 sprite is inlined as a data URI inside an <svg><image>, not an <img>:
// self-contained like <Chest>, crisp at any size (image-rendering: pixelated), and
// it sidesteps the next/no-img-element lint rule. Regenerate from the sprite if it
// changes, do not hand-edit the base64.

const SPRITE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAEaklEQVR42sVX27GsKhBdc2onwISAIfSEACFoCEwIGoKGoCEwIWgIEIKGICH0/QAZHd279v05h6qp4dGPxbJpmhsAxj9sX/uBc/Nfcfp4FLl/2xioXZknW7InJe89AOCFBmE3HwKANBMAtKIHABDRyUbjq9zvHq83A87NIJInwZZsdjyhAxDQ0vjj7vT0iLr+DWRvb2vSTnhW+v0J9kKbYOMrSBHXaxnnOq/jTj+AVJMGEDAqdwBCXh4cb34kzPsT7BlopgRE2cNYykR0AGqyaLzGm3ygpzGDiA7kpZ1tPLw+GMjfX1k8p+owBnCY63x1YuDpNQQEAHHQy7ECoFf251OwBZsSAtVLw5YjqpfOa7aMTquXRrVoyBQ2y7Kt2/d60ttsBBHgvb8MTnZuZmZm5xxbZ5iZWfV0+Lezyf2tqZ4u54xTlzbUSOycY2bm3o4MgE8MiD1nAEbjoIdH7gOA7tK4Po9H46C7B/T0yOuHc3vR2LmZnXM8upqZmcfEAtXH3W1z8zryvI5MNZ3GV/LMzOV4ZOFbBiILJp7/EPB4FnD9O0Mu04LHLiABnMZ5/lnkuKpTgvohCF9Q1MJ7j+cQDdo2KhXPAsFHHle3/kjn/XGPmyCBMelXTbTXG4tROejpgRLtxyeYa3bOMRnJ82p5Xi1LI1kaeaLVri2nFJ5/dm1Pcpv+Zo+MZOcclyPlT3CIATKS3WpZlpJleXa8d87M7OaWlVMsjfwWBDNne24H4gSAjORx7S8dCxIsSDAzH5wLEiyUYOolUy/z2l7+E8i49kxGHgGQkWzXloWSl8jt2rJMawBYOZWdCCVYGmJylAHsdeSFTbu2TIm1LwAwRuFZDVjHGO2FjtFb92W6csPhMC/DkhOGSOlQvDMIEAJCCFm/0DEw53HFbGcU+o66LfEcBvwBgK6Zds7vAAJMXyIACEu4zCOyFNm5NAI9tafcv+ma3pyAdM2uHtjAF9UdEMBs19gHULZlNJdk7NqiujcgR5AUHUsQbrcb7NrmdBoQAAm8miE7Lao7iuqO2a7Z3g0AyzLuRLXxopgaj9nOh2QCAEIAYzvjFTpU9+awY7u2KEUN3RSpSkplXv+2Q3W077tY5PhhiQDISEgj47cFII2E72J/AxIZKk5z+3a1vs1RfbS/DMsbgHMzqkHDmnSdDhWkiayEpLRPx78qPBNzItlZhuVgv1Y9npV+A8iVjFywLBJVF9OnqMWWqf9fSzVu6KJdW1t40YFCHelfwrEi2goF7yMIWye0n0B+2faOAWBJzrOfZTpeRs8pVjC9GjMIIUrY2mIIDaYUE/GIXV/w+1ygjIQRLYgIw1SBEJ1vfgj1d0WpxrlOPNZ/zaRRiuO5f4XmUu47W1tRmu+COpVR37XaqYPMT/3f2Nrugj/v19CIxutcbh9fNBpGKBihLtf3cgoEBfmtncbrQ0X9tb3VnJvzQveh3NKYX0gCU06efomvJbGrJ0UK/5bo0s4n/bf967i34195nG7OTwD+RfsPFHtOpMIz/kIAAAAASUVORK5CYII=";

export function SharpEyesMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="SharpEyes"
      style={{ display: "block" }}
    >
      <image href={SPRITE} width="32" height="32" style={{ imageRendering: "pixelated" }} />
    </svg>
  );
}
