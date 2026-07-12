-- Finish removing Claude.
--
-- Screenshots are parsed by the vision service, which is OpenCV: it matches the
-- client's own icons against the inventory grid and reads the stack counts with the
-- client's own digit glyphs. No model is called. Two things in the schema still
-- described the system we replaced.

-- 1. usage_ledger existed to meter Anthropic API spend: tokens in, tokens out, and
--    a dollar estimate. There is no API spend. Every row we have ever written reads
--    input_tokens=0, output_tokens=0, estimated_cost_usd=0.000000 -- one such row per
--    upload, forever, recording nothing.
--
--    Dropping it rather than leaving it: a table of zeros is worse than no table.
--    Somebody eventually reads it, believes it is measuring something, and concludes
--    the parser is free because the ledger says so -- which is true today by accident,
--    not by measurement. If a paid model comes back (boss-clear parsing is the likely
--    candidate), metering should be reintroduced deliberately, against whatever that
--    thing actually costs.
DROP TABLE IF EXISTS usage_ledger;

-- 2. raw_model_response holds the parser's output. It is not a model response and has
--    not been one since the OpenCV rewrite -- it is a JSON blob of grid coordinates,
--    template match scores and digit reads.
--
--    Names that outlive the thing they describe are not a cosmetic problem. Token
--    persistence was silently broken for days partly because the code around it still
--    talked about a vision model echoing display names back, so nobody reading it had
--    reason to doubt what the join was doing (see V4).
ALTER TABLE screenshots RENAME COLUMN raw_model_response TO raw_parse_result;
