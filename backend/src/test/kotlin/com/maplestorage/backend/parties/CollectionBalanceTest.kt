package com.maplestorage.backend.parties

import kotlin.test.Test
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The two halves of V56: whose pieces a sale was, and what somebody owes you that no drop accounts
// for. See V56__collection_balance.sql.
class CollectionBalanceTest {
    private val self = VestigeHolder(kind = "SELF")
    private val bro = VestigeHolder(kind = "PERSON", personId = "6f1a8f6e-0000-4000-8000-000000000001")
    private val jared = VestigeHolder(kind = "PERSON", personId = "6f1a8f6e-0000-4000-8000-000000000002")
    private val stranger = VestigeHolder(kind = "CHARACTER", characterName = "freeballynn")

    private fun share(
        holder: VestigeHolder,
        pieces: Int,
    ) = VestigeTrancheShareRow(holder, pieces)

    @Test
    fun `a sale may say how many of its pieces were somebody else's`() {
        // The night this exists for: 160 fell, 80 were theirs, you looted the lot and sold it.
        assertNull(shareRefusal(self, 160, "SOLD", listOf(share(bro, 80))))
        assertNull(shareRefusal(self, 160, "SOLD", listOf(share(bro, 60), share(stranger, 40))))
        // Absent is the whole sale being your own, which is every tranche entered before V56.
        assertNull(shareRefusal(self, 160, "KEPT", emptyList()))
    }

    @Test
    fun `a sale cannot give away more than it held`() {
        // The ceiling a check constraint cannot enforce, because it needs the parent row. Crediting
        // 200 pieces out of a sale of 160 hands somebody money the lot never made.
        assertTrue(shareRefusal(self, 160, "SOLD", listOf(share(bro, 200)))!!.contains("more pieces"))
        assertTrue(
            shareRefusal(self, 100, "SOLD", listOf(share(bro, 60), share(jared, 60)))!!
                .contains("more pieces"),
        )
        // Exactly all of it is a night where none of the coupons were yours, which happens.
        assertNull(shareRefusal(self, 160, "SOLD", listOf(share(bro, 160))))
    }

    @Test
    fun `only a sale divides, since the other two fates have nothing to divide`() {
        // A redemption realized nothing, and a purchase is already one creditor's in full at an
        // agreed price. Folding either into this would price those pieces off an average.
        assertTrue(shareRefusal(self, 80, "KEPT", listOf(share(bro, 80)))!!.contains("SOLD"))
        assertTrue(shareRefusal(self, 80, "BOUGHT", listOf(share(bro, 80)))!!.contains("SOLD"))
    }

    @Test
    fun `a sale cannot owe its own pile, nor one person twice`() {
        // Owing yourself is not a debt. The same creditor on two rows would be counted twice rather
        // than added up, which is the quiet wrong number rather than a loud one.
        assertTrue(shareRefusal(self, 160, "SOLD", listOf(share(self, 80)))!!.contains("own pile"))
        assertTrue(
            shareRefusal(self, 160, "SOLD", listOf(share(bro, 40), share(bro, 40)))!!
                .contains("once"),
        )
    }

    @Test
    fun `a share names a creditor the same way a pile names a holder`() {
        assertTrue(
            shareRefusal(self, 80, "SOLD", listOf(share(VestigeHolder(kind = "NOBODY"), 1)))!!
                .contains("kind"),
        )
        assertTrue(
            shareRefusal(self, 80, "SOLD", listOf(share(VestigeHolder(kind = "PERSON"), 1)))!!
                .contains("personId"),
        )
        assertTrue(
            shareRefusal(self, 80, "SOLD", listOf(share(VestigeHolder(kind = "CHARACTER"), 1)))!!
                .contains("characterName"),
        )
        assertTrue(
            shareRefusal(
                self,
                80,
                "SOLD",
                listOf(share(VestigeHolder(kind = "PERSON", personId = "nope"), 1)),
            )!!.contains("not an id"),
        )
        assertTrue(shareRefusal(self, 80, "SOLD", listOf(share(bro, 0)))!!.contains("at least 1"))
    }

    @Test
    fun `an entered debt needs somebody to owe it and money in it`() {
        assertNull(debtRefusal(bro, 1_500_000_000, "Ludi loan"))
        assertNull(debtRefusal(stranger, 1, null))

        // A debt to yourself is not one. A tranche and a payment allow SELF because those are about
        // a PILE, and one of the piles is yours; this is about two people.
        assertTrue(debtRefusal(self, 1, null)!!.contains("kind"))

        assertTrue(debtRefusal(bro, 0, null)!!.contains("between 1"))
        assertTrue(debtRefusal(bro, 1_000_000_000_001, null)!!.contains("between 1"))
        assertTrue(debtRefusal(bro, 1, "x".repeat(121))!!.contains("120"))
        assertNull(debtRefusal(bro, 1, "x".repeat(120)))
    }
}
