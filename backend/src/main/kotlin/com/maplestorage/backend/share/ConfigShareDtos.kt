package com.maplestorage.backend.share

import kotlinx.serialization.Serializable

// The file one account hands another, and what comes back when it is read.
//
// It carries AGREEMENTS and nothing else: who runs what with whom, at which difficulty, for how
// long, on what share. What actually happened (pools, payouts, clears, the roster of a particular
// week) stays behind, because copying a record into an account that was never party to it mints a
// second copy of a debt nobody owes.

/** The format. Bumped when a reader written against an older one would misread a newer file. */
const val SHARE_FORMAT_VERSION = 1

/**
 * The document itself, as handed over.
 *
 * A roster of PEOPLE, plus the configs that name them. That split is the one V21 already makes:
 * a config names characters, and whose they are is said once, so the file needs no owner on a seat.
 *
 * Every character in here is a name, and every boss is a `boss_key`. No UUID crosses: boss_catalog
 * ids are generated per database (R__boss_catalog.sql), so an id in a shared file is a wrong-boss
 * bug waiting on a fresh install.
 */
@Serializable
data class ShareDocument(
    val version: Int = SHARE_FORMAT_VERSION,
    val exportedAt: String,
    /** Who is handing it over, by the name the reader will file them under. */
    val author: String,
    /** INTERACTIVE or HEROIC. Decides whether a split is a figure that can change hands at all. */
    val worldType: String,
    val people: List<SharePerson>,
    val configs: List<ShareConfig>,
)

/**
 * A person and the characters that are theirs.
 *
 * The author is one of these, flagged. A reader picks which entry is THEM, and everything else
 * follows: the entry they claim becomes their own roster, and every other entry, the author's
 * included, becomes somebody they run with.
 */
@Serializable
data class SharePerson(
    val name: String,
    val characters: List<String>,
    val author: Boolean = false,
)

/**
 * One arrangement: a roster, on a boss, at a difficulty.
 *
 * `seats` is the WHOLE roster in reading order, the anchor included, which is how party_member
 * already stores it. `anchor` only names which of them owns the config. That is what makes the
 * pivot a one-field change: the reader anchors on their own seat instead, and the roster is
 * untouched.
 */
@Serializable
data class ShareConfig(
    val anchor: String,
    val bossKey: String,
    val difficulty: String? = null,
    val minutes: Int? = null,
    val seats: List<ShareSeat>,
)

@Serializable
data class ShareSeat(
    val name: String,
    val shares: Int = 1,
)

/**
 * The document, plus what was left out of it.
 *
 * Said out loud rather than dropped quietly. A file that silently carried three of five configs
 * reads as the whole arrangement, which is the confidently-wrong screen this repo exists to
 * prevent.
 */
@Serializable
data class ShareExportResponse(
    val document: ShareDocument,
    val omitted: ShareOmissions,
)

/** What the export did not carry, and how much of it. Each field is a count of configs or seats. */
@Serializable
data class ShareOmissions(
    /** Retired: no longer run, and worth only the pool that cannot cross anyway (V33). */
    val retiredConfigs: Int = 0,
    /** Solo: nobody else was there, so there is nothing in it for a reader (V30). */
    val soloConfigs: Int = 0,
    /** One-off: a night that happened, not an arrangement that stands (V32). */
    val oneOffConfigs: Int = 0,
    /** Seats that are not in a usual roster: a guest, or somebody who has left it (V27). */
    val guestSeats: Int = 0,
)
