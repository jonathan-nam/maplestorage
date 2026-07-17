// The in-game Sharp Eyes skill icon, shipped as the brand mark so the header
// matches the favicon (app/icon.png) exactly.
//
// The 32x32 sprite is inlined as a data URI inside an <svg><image>, not an <img>:
// self-contained like <Chest>, crisp at any size (image-rendering: pixelated), and
// it sidesteps the next/no-img-element lint rule. Regenerate from the sprite if it
// changes, do not hand-edit the base64.

const SPRITE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAElUlEQVR42sWX0ZXyOAyFP/ZMA04JpgRRQqYEU0KmhFAClEBKiEsIJUQl4BJwCdqHJCYBZnef/tU5HMyMrXst60r2jq0Zf8Z2bwPAhvH+R9C/D/uCvVuD1+I5aFUmjvLgxA8NAYDE7T8BeGo6Ig2Box43/g5aEdLA6Xgo+DaMd5PRmYzOFpPR2d0Gk9FZY2KDtXa32sz8P37uVltjslm/9rn8PvejAfa1Zj7KA4CDVjjxZceqCS8dNY6EJyG/7FyJKKqUiMkc1VEeJQJr2xBIHPH0szOIM4FRHAfNRDIimcjlDdxlh0vbUNeciRw2/l/tr2UQpOWo2zNWTbOzzCgPeqmnaKjDq+OKK2OXoJe6gC/fnlT8HfVGkPYzgbUtQK/Jc9QbvdQlKgHHKK6sOeqtgC8WlbLmk309J14KkIjQS42nL2eWUp52wY1GoCMXJ41Mu1vmHKgK8cSRCxldRaVdRWGTAxO4R1U5AqM8E7NKO0KoifHGKX3ezfL/dQSWYw3CczPcALcpQGZmNlhrZn4lo7CRj+uxxury98XuFqyx2lzPRmp3C0XGi4QnOQ9FhoXAYK0N1trZng6mxfWvwK+2JtJY/eJHSp0YrC0ENklYE0n4chwpZVocj2BcGYpEAX745qAVP3yv6kDPlYFHMFocKeWN7hN+o4qPKgjUJMmklBlDwNN/BFNVRnmgS9V5IeXpGUMgpUySTEQ/FrBCIHLjQuZHO5y6An7QClVFRFDVUkxEpChmKTLreVMNmEh4dRuM17Zow3jnxIEMtBJouPKqjsVEhBa3OY6n1PStrAN0/HDRuMp7SkP6ei02F40g0Gks+l8fxSJRke1xLOSuDCSOVHGH945GAt0MviZ1SfpeBxoJE4FCylFJ5hAjsJuIrJw8w/KMRBWnDp8DoFvfSzQz0DBsCZQSKtBwpZHrFHqZnLlEIeK8e+OQ5yqIQPYg6p47nn1OVRAcDUulLwTy6qw75vBL5oGnIpH91CJdgqyZEGoEj5KI8VaAS17IVoIdkUY8gby51hQCV2lKLbgROM4td68Zh9skEB5ivHENRhXniGRwuo3KKI5q1n1PS02kw+E/yfCk3bYj0uLUcZcH9zmUy/j1ANzqf+t5e83F13RZyXSa1qmxTcKTdpyloSay18x9dYNZxnkeV2lHx09R0F6rQmS/WrPXipsognLRJYDPevj1eg84aldADlqRJOPVlQK03v1aMW5VE9wqsRcSERjmO8Or2TDerbdr6YB3C3a1xmR01lptznjrjq7HzHzpgOvu54yy5mpN8Smjs96uny+lgQYEjnoqzFqZJF7TchOd2Vc0EjiljsN8xo2EZ6+XTM904biJ0mmkK/7OE85vObCQSCQyigB+vgd7PMx1v9PIOTQ0XOnkh04jSTINNYs4PYkaOM1rHPIG/kagkJhvLdPn6fA8t9QsnlPsIMApdoQgnKnnebG03oRQzw8VT/3Pd8JPr5upQCUSbIj4uaPV8/e02y3w2sdv4AuB3fdhX55mn0gsD5SFyPRbS0YnPLcVyL8BX6KWp9nmcXruxz/yOF2/C3f/9/P8by1SqWs/b30IAAAAAElFTkSuQmCC";

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
