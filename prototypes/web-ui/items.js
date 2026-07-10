(function () {
  "use strict";

  var itemRows = document.getElementById("item-rows");

  // Fake per-character breakdown, standing in for a real SUM(quantity) GROUP BY
  // tokenCatalogId query joined with CharacterTokenCount (see PLAN.md) — mirrors
  // the same fake characters/quantities used on the Character detail page so
  // the two views agree with each other. Fixed at the 6 tokens — the catalog
  // doesn't grow, so there's nothing else to seed here.
  var FAKE_BREAKDOWN = {
    "Distorted Ambition": { redeemThreshold: 10, entries: [
      { character: "Bubbling", qty: 4, updated: "2 hours ago" },
      { character: "Squishy", qty: 9, updated: "3 days ago" }
    ] },
    "Blissful Fantasy Shard": { redeemThreshold: 10, entries: [] },
    "Echo of Ancient Resolve": { redeemThreshold: 10, entries: [] },
    "Ferocious Beast Entanglement Ring": { redeemThreshold: 10, entries: [
      { character: "Nightshade", qty: 3, updated: "5 days ago" }
    ] },
    "Kalos's Residual Determination": { redeemThreshold: 10, entries: [
      { character: "Bubbling", qty: 7, updated: "2 hours ago" },
      { character: "Nightshade", qty: 10, updated: "5 days ago" }
    ] },
    "Trace of Eternal Loyalty": { redeemThreshold: 10, entries: [] }
  };

  function renderBreakdownPanel(name) {
    var data = FAKE_BREAKDOWN[name];
    var panel = document.createElement("tr");
    panel.className = "breakdown-row";
    var cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "breakdown-cell";

    if (!data || data.entries.length === 0) {
      cell.textContent = "No characters have this token yet — upload an inventory screenshot to populate it.";
    } else {
      data.entries.forEach(function (entry) {
        var line = document.createElement("div");
        line.className = "breakdown-line";
        line.textContent = entry.character + ": " + entry.qty + ", as of " + entry.updated;
        cell.appendChild(line);
      });
    }

    panel.appendChild(cell);
    return panel;
  }

  function toggleBreakdown(row) {
    var next = row.nextElementSibling;
    if (next && next.classList.contains("breakdown-row")) {
      next.remove();
      return;
    }
    var panel = renderBreakdownPanel(row.dataset.name);
    row.parentNode.insertBefore(panel, row.nextSibling);
  }

  Array.prototype.forEach.call(itemRows.querySelectorAll("tr"), function (row) {
    row.addEventListener("click", function () {
      toggleBreakdown(row);
    });
  });
})();
