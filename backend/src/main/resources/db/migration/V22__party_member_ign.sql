-- What a cell says, and who it actually is.
--
-- The sheet this grid comes from writes the CLASS in the cell: "2nd mech", "zero", "adele". Those
-- are labels, not characters. The real characters behind them are morebuff12, onetwothreeo and
-- warrior2020, and it is the IGN that a sprite lookup and the link to your own roster need. A
-- label typed into Nexon's ranking endpoint finds nothing, so a grid that only stored the label
-- would show every seat without a portrait and link none of them.
--
-- party_member.name stays the label, because it is what the grid draws. NULL ign means the label
-- IS the name, which is the ordinary case for anyone who writes IGNs in their sheet.

ALTER TABLE party_member ADD COLUMN ign TEXT;
