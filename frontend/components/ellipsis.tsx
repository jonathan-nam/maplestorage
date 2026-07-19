/**
 * An ellipsis whose dots arrive one at a time and start over, so a parse that takes a few
 * seconds looks alive rather than hung. The dots always occupy their space and only change
 * opacity, so nothing beside them shifts.
 */
export function Ellipsis() {
  return (
    <span className="ellipsis" aria-hidden="true">
      <span className="ellipsis-dot">.</span>
      <span className="ellipsis-dot">.</span>
      <span className="ellipsis-dot">.</span>
    </span>
  );
}
