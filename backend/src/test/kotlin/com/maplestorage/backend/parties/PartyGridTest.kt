package com.maplestorage.backend.parties

import com.maplestorage.backend.config.Env
import com.maplestorage.backend.db.Characters
import com.maplestorage.backend.db.Party
import com.maplestorage.backend.db.Person
import com.maplestorage.backend.users.ensureUser
import kotlinx.datetime.LocalDate
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.Database
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Clock
import kotlin.uuid.Uuid

/**
 * The party grid, against a real Postgres.
 *
 * The grid is the roster as it is actually kept by hand: a column per person, a row per party, and
 * the character they bring in the cell (test-fixtures/occluded/boss matrix.png). The claims worth a
 * database to check are the ones about identity, because getting them wrong is invisible: that a
 * seat survives its character changing (loot payouts point at that row), that a person is one
 * person across every party, and that the ownership filter holds.
 */
class PartyGridTest {
    private val userOneId = "user_test_grid_1"
    private val userTwoId = "user_test_grid_2"

    @BeforeTest
    fun migrate() {
        val jdbcUrl = "jdbc:postgresql://${Env.dbHost}:${Env.dbPort}/${Env.dbName}"
        Flyway
            .configure()
            .dataSource(jdbcUrl, Env.dbUsername, Env.dbPassword)
            .load()
            .migrate()
        Database.connect(
            url = jdbcUrl,
            driver = "org.postgresql.Driver",
            user = Env.dbUsername,
            password = Env.dbPassword,
        )
    }

    @AfterTest
    fun cleanUp() {
        transaction {
            // Seats cascade from party; people are referenced by them, so parties go first.
            Party.deleteWhere { (Party.userId eq userOneId) or (Party.userId eq userTwoId) }
            Person.deleteWhere { (Person.userId eq userOneId) or (Person.userId eq userTwoId) }
            Characters.deleteWhere { (Characters.userId eq userOneId) or (Characters.userId eq userTwoId) }
        }
    }

    private fun addCharacter(
        userId: String,
        name: String,
        sprite: String? = null,
    ): Uuid {
        ensureUser(userId, "$userId@example.com")
        val id = Uuid.random()
        val now = Clock.System.now()
        Characters.insert {
            it[Characters.id] = id
            it[Characters.userId] = userId
            it[Characters.name] = name
            it[spriteImgUrl] = sprite
            it[createdAt] = now
            it[updatedAt] = now
            it[position] = 0
        }
        return id
    }

    private fun column(
        key: String,
        name: String,
        mvp: Boolean = false,
        id: String? = null,
    ) = GridPersonRequest(key, id, name, mvp)

    private fun row(
        name: String,
        bosses: List<String> = emptyList(),
        cells: List<Pair<String, String>> = emptyList(),
        id: String? = null,
        igns: Map<String, String> = emptyMap(),
    ) = GridPartyRequest(id, name, bosses, cells.map { GridSeatRequest(it.first, it.second, igns[it.second]) })

    private fun save(
        userId: String,
        people: List<GridPersonRequest>,
        parties: List<GridPartyRequest>,
        sprites: Map<String, String?> = emptyMap(),
    ): PartyGridResponse {
        ensureUser(userId, "$userId@example.com")
        return saveGrid(userId, SaveGridRequest(people, parties), Clock.System.now(), sprites)
    }

    @Test
    fun `saves the sheet as it is written, with people as columns and characters in the cells`() {
        transaction {
            val main = addCharacter(userOneId, "Premial")
            val people = listOf(column("me", "Me"), column("j", "Jared", mvp = true))
            val parties =
                listOf(
                    row("Xkalos duo", listOf("kalos-the-guardian"), listOf("me" to "Premial", "j" to "Lynn")),
                    row("Limbo trio", listOf("limbo"), listOf("j" to "Corsair")),
                )
            val grid = save(userOneId, people, parties)

            assertEquals(listOf("Me", "Jared"), grid.people.map { it.name })
            assertEquals(listOf("Xkalos duo", "Limbo trio"), grid.parties.map { it.name })

            val kalos = grid.parties.first { it.name == "Xkalos duo" }
            assertEquals(listOf("Premial", "Lynn"), kalos.members.map { it.name })
            // The cell that names one of your own characters is linked to it, by name, so the seat
            // shows the roster's sprite and that character's parties can be found.
            assertEquals(main.toString(), kalos.members[0].characterId)
            assertNull(kalos.members[1].characterId)
            // MVP is the PERSON's, so it reads the same in every row they appear in.
            assertTrue(kalos.members[1].mvp)
            assertTrue(
                grid.parties
                    .first { it.name == "Limbo trio" }
                    .members
                    .single()
                    .mvp,
            )
        }
    }

    @Test
    fun `a person keeps their seat when the character in the cell changes`() {
        transaction {
            val people = listOf(column("j", "Jared"))
            val before = save(userOneId, people, listOf(row("Limbo carry", listOf("limbo"), listOf("j" to "Corsair"))))
            val seat =
                before.parties
                    .single()
                    .members
                    .single()
            val personId = before.people.single().id

            val after =
                save(
                    userOneId,
                    listOf(column("j", "Jared", id = personId)),
                    listOf(
                        row(
                            "Limbo carry",
                            listOf("limbo"),
                            listOf("j" to "Merc"),
                            id = before.parties.single().id,
                        ),
                    ),
                )

            val moved =
                after.parties
                    .single()
                    .members
                    .single()
            // Same seat row, different character. A payout pointing at this seat still points at
            // Jared, which is the whole reason seats key on the person rather than on the name.
            assertEquals(seat.id, moved.id)
            assertEquals(personId, moved.personId)
            assertEquals("Merc", moved.name)
        }
    }

    @Test
    fun `another account's grid is neither read nor written`() {
        transaction {
            save(userTwoId, listOf(column("t", "Theirs")), listOf(row("Theirs", listOf("limbo"), listOf("t" to "X"))))
            save(userOneId, listOf(column("m", "Mine")), listOf(row("Mine", listOf("limbo"), listOf("m" to "Y"))))

            val mine = gridFor(userOneId)
            assertEquals(listOf("Mine"), mine.people.map { it.name })
            assertEquals(listOf("Mine"), mine.parties.map { it.name })
            // The other account still has everything it had: a full-replace save must replace only
            // the caller's grid.
            assertEquals(listOf("Theirs"), gridFor(userTwoId).people.map { it.name })
        }
    }

    @Test
    fun `a row or column left out of the save is removed`() {
        transaction {
            val first =
                save(
                    userOneId,
                    listOf(column("a", "Anna"), column("b", "Ben")),
                    listOf(
                        row("Keep", listOf("limbo"), listOf("a" to "One")),
                        row("Drop", listOf("baldrix"), listOf("b" to "Two")),
                    ),
                )
            val anna = first.people.first { it.name == "Anna" }
            val keep = first.parties.first { it.name == "Keep" }

            val after =
                save(
                    userOneId,
                    listOf(column("a", "Anna", id = anna.id)),
                    listOf(row("Keep", listOf("limbo"), listOf("a" to "One"), id = keep.id)),
                )

            assertEquals(listOf("Anna"), after.people.map { it.name })
            assertEquals(listOf("Keep"), after.parties.map { it.name })
        }
    }

    @Test
    fun `refuses a grid that cannot be saved as asked`() {
        transaction {
            ensureUser(userOneId, "$userOneId@example.com")
            val people = listOf(column("a", "Anna"), column("b", "Ben"))

            fun check(
                cols: List<GridPersonRequest> = people,
                rows: List<GridPartyRequest>,
            ) = validateGrid(SaveGridRequest(cols, rows), userOneId, emptySet(), emptySet())

            val seven = (1..7).map { "a" to "C$it" }
            assertEquals(
                "two people share a name",
                check(cols = listOf(column("a", "Anna"), column("b", "anna")), rows = emptyList()),
            )
            assertEquals(
                "each person needs its own key",
                check(cols = listOf(column("a", "Anna"), column("a", "Ben")), rows = emptyList()),
            )
            assertEquals("a person needs a name", check(cols = listOf(column("a", " ")), rows = emptyList()))
            assertEquals("a party needs at least one member", check(rows = listOf(row("Empty"))))
            assertEquals("a party holds at most 6 members", check(rows = listOf(row("Big", cells = seven))))
            assertEquals(
                "a filled cell needs a character name",
                check(rows = listOf(row("Blank", cells = listOf("a" to "  ")))),
            )
            assertEquals(
                "a cell names somebody who is not in the grid",
                check(rows = listOf(row("Stray", cells = listOf("zz" to "Ghost")))),
            )
            assertEquals(
                "a person can hold only one seat in a party",
                check(rows = listOf(row("Twice", cells = listOf("a" to "One", "a" to "Two")))),
            )
            // Zakum is in catalog/bosses.yaml but untracked, so it is seeded into no table.
            assertEquals(
                "unknown boss key",
                check(rows = listOf(row("Bad boss", listOf("zakum"), listOf("a" to "One")))),
            )
            assertNull(check(rows = listOf(row("Fine", listOf("limbo"), listOf("a" to "One")))))
        }
    }

    @Test
    fun `a person the loot pool points at cannot be removed from the grid`() {
        transaction {
            val grid =
                save(
                    userOneId,
                    listOf(column("a", "Anna"), column("b", "Ben")),
                    listOf(row("Limbo duo", listOf("limbo"), listOf("a" to "One", "b" to "Two"))),
                )
            val party = grid.parties.single()
            val partyId = Uuid.parse(party.id)
            val seller = party.members.first { it.name == "One" }
            val dropped = LocalDate.parse("2026-07-20")
            val lootId =
                addLoot(partyId, dropIdForKey("grindstone-of-faith"), null, null, dropped, Clock.System.now())
            sellLoot(
                lootId,
                SellLootRequest(9_000_000_000, "LISTED", "FAIR", seller.id),
                Uuid.parse(seller.id),
                partyId,
                Clock.System.now(),
            )

            val ben = grid.people.first { it.name == "Ben" }
            val anna = grid.people.first { it.name == "Anna" }
            val withoutBen =
                SaveGridRequest(
                    listOf(column("a", "Anna", id = anna.id)),
                    listOf(row("Limbo duo", listOf("limbo"), listOf("a" to "One"), id = party.id)),
                )
            assertEquals(
                "a person with loot history cannot be removed, delete or reassign their loot first",
                validateGrid(withoutBen, userOneId, setOf(Uuid.parse(anna.id), Uuid.parse(ben.id)), setOf(partyId)),
            )

            // And the row itself cannot go while its pool has anything in it.
            val withoutParty =
                SaveGridRequest(
                    listOf(column("a", "Anna", id = anna.id), column("b", "Ben", id = ben.id)),
                    emptyList(),
                )
            assertEquals(
                "a party with loot in its pool cannot be removed, clear its pool first",
                validateGrid(withoutParty, userOneId, setOf(Uuid.parse(anna.id), Uuid.parse(ben.id)), setOf(partyId)),
            )
        }
    }

    @Test
    fun `a cell labelled by class is looked up and linked by the IGN behind it`() {
        transaction {
            // The sheet writes the class in the cell. Nexon has never heard of "2nd mech", and the
            // roster is keyed by the character's real name, so both jobs use the IGN.
            val mech = addCharacter(userOneId, "morebuff12", sprite = "https://nexon.example/mech.png")
            val cells = listOf("me" to "2nd mech", "j" to "lynn")
            val igns = mapOf("2nd mech" to "morebuff12", "lynn" to "acornacorn")
            val grid =
                save(
                    userOneId,
                    listOf(column("me", "Jman"), column("j", "Jared")),
                    listOf(row("Limbo carry", listOf("limbo"), cells, igns = igns)),
                    mapOf("acornacorn" to "https://nexon.example/acorn.png"),
                )

            val seats = grid.parties.single().members
            assertEquals(listOf("2nd mech", "lynn"), seats.map { it.name })
            assertEquals(listOf("morebuff12", "acornacorn"), seats.map { it.ign })
            // Linked to the roster by IGN, so the cell keeps its label and still shows the sprite.
            assertEquals(mech.toString(), seats[0].characterId)
            assertEquals("https://nexon.example/mech.png", seats[0].spriteImgUrl)
            assertEquals("https://nexon.example/acorn.png", seats[1].spriteImgUrl)
        }
    }

    @Test
    fun `a cell of yours shows the character's sprite, and other cells show what was looked up`() {
        transaction {
            addCharacter(userOneId, "Premial", sprite = "https://nexon.example/premial.png")
            // Lynn resolved, Nobody did not. Both were asked, which is what the null records.
            val sprites = mapOf("Lynn" to "https://nexon.example/lynn.png", "Nobody" to null)
            val grid =
                save(
                    userOneId,
                    listOf(column("me", "Me"), column("j", "Jared"), column("g", "Ghost")),
                    listOf(
                        row(
                            "Xkalos duo",
                            listOf("kalos-the-guardian"),
                            listOf("me" to "Premial", "j" to "Lynn", "g" to "Nobody"),
                        ),
                    ),
                    sprites,
                )
            val seats = grid.parties.single().members
            assertEquals("https://nexon.example/premial.png", seats[0].spriteImgUrl)
            assertEquals("https://nexon.example/lynn.png", seats[1].spriteImgUrl)
            // Asked and not found is an ordinary answer, and the client draws initials for it.
            assertNull(seats[2].spriteImgUrl)
            assertNotNull(grid.people.first { it.name == "Ghost" })
        }
    }
}
