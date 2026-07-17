// The in-game Sharp Eyes skill icon (classic art, symmetrized), shipped as the
// brand mark so the header matches the favicon (app/icon.png) exactly.
//
// The classic hidden-street sprite is slightly asymmetric above/around the eye;
// this is the left half mirrored so the flourishes and pupil balance at small sizes.
//
// The 32x32 sprite is inlined as a data URI inside an <svg><image>, not an <img>:
// self-contained like <Chest>, crisp at any size (image-rendering: pixelated), and
// it sidesteps the next/no-img-element lint rule. Regenerate from the sprite if it
// changes, do not hand-edit the base64.

const SPRITE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAEIElEQVR42sVX27WkKhDdZ9ZJgA4BQ6BD0BA0BDoEDEFDaEPAEDQEDAFCkBBqPng0tvbcc39mWKtX86jatSmLovgCQPiH7bscGGP/itH7vcr9r+QBZdo8OQh9Utq2DQAwo4f/AMwAtBgAAEKI03q/dbk/3ucXAWMshOAnwUHobHjFCMBDieWPuxu3BgBDDZWJlHivDTnc79WLwIz+JNRvHTgLfcl1NuABDG9E+q0BAzLByQWjzp8xET11IJA80K+Rba0PY84RXO8BJTT6rTkQGMSCcesAFj6Fc7jESePkge93Fw61xmPtDmMAh7lx604eGLcOzgMpQJ71MY78xdzpFKRgqxlDNzfQ7YJufu1Ut8FoNzfoXAMewybt9rAe9RJGyzm2bbsMTjLGEhGRMYa0kUREVD/F4V9bmfup1U9xOaftBwwjyRgTbVkCQN9XRyn7DMAiDZrpnvsA0IxxrM7jJD/hnuUTFvtwcsgYS8YYWowiIqIlekGo4+7SnN0XsvtCQonT+Eq+xFyMImPMZw8EpjKcf+9xf1Qwz1eGdKvDvQhIAKdxnn9UOa4Y5MfcET2gchwIyUlInnfGJScmGDHB6L9akuOFfsJ7fX+VPfAiYFU2bndNdtfEJScu+cmI3oeknH96H05yST/hJRLB1juBaNzsmnjLibf8cofJOBGRsQMZGwx/IkFEGc+UJN4JCMlp2Z+Xhkv3l8bTfEniXf6dyLI/I4mCgJCc9D4Qq/klc70PxOMaAKpNnY2kX23qTIDXUefCkyyuCclfp0DKGo9uwr6EaK+aEL3qGa5o74scC8BN7nSo3eQOidd7DzW0Bzy7WOyLxa2pMAw1HtOEXwAw9mth/AbAQz5beADe+cv7n7cMjHMwzsHbc4opdeWzBeAjNrAvFmO/FndB1K+6G8AAq/fQB9AOQTnJ6H1Ad+shjAAXLBtzjw16H3LK8/AAB+Z+irsPmFV3g9V7xvsCQLwNt0o9hIti7TdYbQ/JBAAYA5bBYvYjult/2LHeB7RMoekr+MJlKYlVXXXABwA3u0BASA4uef6OXHJsY+gnIgnkfa5sV+tpTqgjvpsctsm9CpJuaqBluK+7qQOXwSs+KpXp+EeFZ/Qcizhucgd8LZdjRZSinHMH5zi6MeR3puLHmv9n6RtrXD8GXK10xk6BcqiIUqGwbYGEVpHtO5EfttJwubGXHXesiB5rE0upJZNgrIVWGpPvsY6uPOUfyvIXyVpySDZACAHv52w82ZHseV2W92uDc534VgGvDVo2HOZm31/KfcJKRWm+C5Sp/3jNKlMfZP7U/wlWugt+lWV1vzWncjvV/JLVkKy+XP+pXMIvK+rv9FYzxuaF8aLmTy8khjUnz82Nh1qPAfC+jjrqEufd/V/l6/ipl7/yOH10zflx+q/ab5Ovot3saCRZAAAAAElFTkSuQmCC";

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
