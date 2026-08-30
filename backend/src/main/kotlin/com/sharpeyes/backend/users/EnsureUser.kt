package com.sharpeyes.backend.users

import com.sharpeyes.backend.db.Users
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import kotlin.time.Clock

// Called as the first statement inside the same `transaction { }` block as
// the route's main DB work (Characters/Screenshots both FK to
// Users). No code creates Users rows any other way. insertIgnore
// (-> Postgres INSERT ... ON CONFLICT DO NOTHING) avoids both a race
// between two concurrent first-requests for the same new user and a
// round-trip SELECT on the overwhelmingly common case where the row
// already exists.
fun ensureUser(
    userId: String,
    email: String,
) {
    Users.insertIgnore {
        it[id] = userId
        it[Users.email] = email
        it[createdAt] = Clock.System.now()
    }
}
