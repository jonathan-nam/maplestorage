import { dropSections } from "@/lib/drop-sections";

// The Drop Log's loading state: the page's own chrome, not a line of text where a page will be.
//
// A one-line "Loading..." standing in for a ledger several screens tall is a hard swap however it
// is faded, because 95% of the viewport goes from empty to full in one step. Screenshotting the
// real navigation is what settled it: 1.3s of an all-but-empty screen, then everything at once.
//
// Built from the real classes rather than hand-measured shapes, for the reason app/bosses/loading.tsx
// gives: a skeleton that restates the metrics by hand is what put the inventory window 30px out of
// place (#77). The tabs and the form ARE the real markup, disabled. Only the figures are shimmer,
// because those are the one thing that must never be guessed at.

// Enough rows to fill the fold at 900px without pretending to know how many there are. The list is
// the one part whose length is genuinely unknown, so it fades rather than claiming a count.
const ROWS = 4;

function Row() {
  return (
    <li className="droplog-row">
      <div className="droplog-row-head">
        <span className="party-row-toggle is-empty" aria-hidden="true" />
        <span className="loot-icon skeleton" />
        <span className="droplog-title">
          <span className="loot-name">
            <span className="skeleton sk-line" style={{ width: "132px" }} />
          </span>
          <span className="loot-meta">
            <span className="skeleton sk-line" style={{ width: "190px" }} />
          </span>
        </span>
        <span className="droplog-amounts">
          <span className="droplog-take">
            <span className="skeleton sk-line" style={{ width: "104px" }} />
          </span>
          <span className="loot-share-nets">
            <span className="skeleton sk-line" style={{ width: "88px" }} />
          </span>
        </span>
      </div>
    </li>
  );
}

export function DropLogSkeleton() {
  return (
    <div role="status" aria-label="Loading your drops">
      {/* The real strip. dropSections() is a constant, so this cannot drift from the loaded page. */}
      <div className="basis-row droplog-sections" aria-hidden="true">
        {dropSections().map((s, i) => (
          <button
            key={s.key}
            type="button"
            className={i === 0 ? "basis-tab active" : "basis-tab"}
            disabled
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* The real Add Drop panel, down to the disabled controls, so its height is its own and not a
          number copied out of it. */}
      <section className="loot-pool add-panel" aria-hidden="true">
        <h2 className="loot-pool-title">Add Drop</h2>
        <form className="loot-add">
          <select className="split-input" disabled aria-hidden="true">
            <option>pick a boss</option>
          </select>
          <button type="button" className="split-input drop-select" disabled>
            <span className="drop-select-label is-empty">Select a drop...</span>
            <span className="drop-select-arrow" aria-hidden="true">
              &#9662;
            </span>
          </button>
          <button type="submit" className="party-save" disabled>
            Add drop
          </button>
        </form>
      </section>

      {/* Three tiles, shimmer in place of both the label and the figure. Two of the three only exist
          in a world that trades, and drawing "Sold for" at somebody who will never see it is the
          kind of confident wrong statement this repo exists to avoid. The height is the same either
          way, which is all the tiles are here to hold. */}
      <div className="stat-row" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div className="stat-tile" key={i}>
            <span className="stat-label">
              <span className="skeleton sk-line" style={{ width: "54px" }} />
            </span>
            <span className="stat-value">
              <span className="skeleton sk-line" style={{ width: "118px", height: "15px" }} />
            </span>
            <span className="stat-note">
              <span className="skeleton sk-line" style={{ width: "92px", height: "9px" }} />
            </span>
          </div>
        ))}
      </div>

      {/* The Group picker. Real markup again, because measuring its 57px by hand and pasting the
          number in is how the rows below end up landing somewhere else. */}
      <div className="party-toolbar" aria-hidden="true">
        <label className="droplog-filter">
          <span className="stat-label">Group</span>
          <select className="split-input" disabled>
            <option>Month</option>
          </select>
        </label>
      </div>

      <section className="party-group" aria-hidden="true">
        <header className="droplog-group-head">
          <h2 className="party-group-name">
            <span className="skeleton sk-line" style={{ width: "108px", height: "14px" }} />
          </h2>
          <span className="droplog-group-total">
            <span className="skeleton sk-line" style={{ width: "120px" }} />
          </span>
        </header>
        <ul className="droplog-list">
          {Array.from({ length: ROWS }).map((_, i) => (
            <Row key={i} />
          ))}
        </ul>
      </section>
    </div>
  );
}
