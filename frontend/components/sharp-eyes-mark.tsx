// The in-game Sharp Eyes skill icon (classic art, symmetrized, with the eye
// outline softened from black to green), shipped as the brand mark so the header
// matches the favicon (app/icon.png) exactly.
//
// The 32x32 sprite is inlined as a data URI inside an <svg><image>, not an <img>:
// self-contained like <Chest>, crisp at any size (image-rendering: pixelated), and
// it sidesteps the next/no-img-element lint rule. Regenerate from the sprite if it
// changes, do not hand-edit the base64.

const SPRITE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAER0lEQVR42sVXu5WsOBC9886sN446BOG3ow4BQkDGBKDOYMAYcw3YDCCANdQhQAgiBLQZoADWqDX0aWjo2XnOezqnT0ul0q2rUklVvAAg/Mb2uh4YM/8So5dLlvov0QOVKZOwEXq3aJomAMANNdwTYAagRAMAEELs5utJpn57ud0JGDNDCL5TbIROhke0ABwqMXy5u3YqADDkqBKRNd59QxaXS3YncEO9U6onCc58X3GdDDgAzQOReirAgESwt96odXtMBE9tCEQP1GNgm+vNmHN41zugEhr1VGwINGJAO0mA+aOwFoc4cRw98ProwibXuI5yMwawkbWT3HmgnSSsA2KAdPk2jtyBbHcLYrDljEHeCuhygLzdd6pLb1TeCkhbgIewibvdzId1EaPkHNM0HQYnGTMTEZExhrRRRESUd2Lzr2eV+rHlnTiU6fkJhlFkjAm2ZgJAr0dXKfkMwKAMiv6S+gBQtGFc7cdRv8cl6Ucs9uTmkDEzGWNoMBUREQ3BC6La7i7K5mWgeRlIVGI3PtJfYw6mImPMcw94psrff+dwuWYw3f2FtKPFZRWQAHbjJL9mKa4Y1NO3I3igSnEgFCeheNoZV5yYYMQEo/9rUY+v1ke8+/lXBx5gnum1l9CNf06L+goAmLttjri5Fn/+9fdG9vnxjpJVWMySZFnwwBDwZC3RKe2DwR3EgFCczKKJl5x4yQ93qJeGzvXZ72RuyMwNERGd6zPppTlcE/HMopMnogcSAaE4DUt3aHjt/rXxKF+TeNR/JDIsXSCxIiAUJ700xHJ+yFwvDfEwd67PlJs8GYm/3OSJAM/DmgNPsjAnFL/HgFI5rrLHMvizzgp/dlXnU7RzbnNotre7S217i7fTW3pEnHOomnKDNw8zlmHGqcjQNDmufY8fANDW48r4CYCD6ko4AM66w/zPSwbGORjn4OX+iVmvVV0JwAVsYBlmtPW4ygVhfSZPAANmvfg+gLLxi6PO58e7vwHiD3DBkrG3f/7F58d7ulEODuDAre7D7j1mJk+Y9ZLwXgAQL31WyRufKMZ6wqznzWMCAIwBQzN/eQ2LOoNbuSw+YpnMNvgAYG/WExCKgyvuzxYAVxxT6/uRSAR5lK3b0XyUiWqLb3uLqbf3gkT2BbTy+Vr2Elx5r7iwyHQ/V7BGz7GAY3u7wddq2FZEMco5t7CWQ7b+fWdVOKzbT5a+ocZ1rcfVlU7YMVA2FVEsFKbJk9BVYPtI5JttbXi9sbsdu62IrmMRSqkhkWCshK40eldjDDERbvmTsvxOMlccijUQQsC5WzIe7SjWHZfl9VhgXyc+VMBjgZI1DwmqPtR7hhWL0pQLKpN/mWYrk290vup/Byvmgh/rsrqeil25HWt+xXIolh/Of1cv4q8r6tf4rWbMnCbag5o/fiExjOnxnGy7qfUYAOfysKY6xHl0/8v667jTwy/5OL3KYv9x+rvaf2HWZgpy6tYXAAAAAElFTkSuQmCC";

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
