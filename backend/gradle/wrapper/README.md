gradlew, gradlew.bat, gradle-wrapper.properties, and gradle-wrapper.jar are
generated on first dev container start by .devcontainer/post-create.sh
(`gradle wrapper --gradle-version 8.12`), not hand-written -- the wrapper jar
is a binary that can't be authored directly. Delete this file once that's
run; its presence here is just so an empty `gradle/wrapper/` directory isn't
mistaken for something broken before the container has started once.
