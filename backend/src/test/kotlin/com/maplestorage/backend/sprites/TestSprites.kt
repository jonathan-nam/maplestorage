package com.maplestorage.backend.sprites

/**
 * A real 1x1 PNG: signature, IHDR, one IDAT, IEND, with valid CRCs. 70 bytes.
 *
 * Shared because every sprite test needs one and the obvious shortcut is a stub that starts with the
 * right 8 bytes and stops. Those stubs are why SpriteCache now has a minimum size: one of them passed
 * the signature check and was stored, which is what a TRUNCATED response from Nexon also looks like.
 * A fixture that could not survive the real validation is a test that agrees with a bug.
 */
private const val TEST_PNG_HEX =
    "89504e470d0a1a0a" + // signature
        "0000000d49484452000000010000000108060000001f15c489" + // IHDR, 1x1 RGBA
        "0000000d49444154789c63f8cfc0f01f00050001ff89993d1d" + // IDAT
        "0000000049454e44ae426082" // IEND

val TEST_PNG: ByteArray = TEST_PNG_HEX.hexToByteArray()

/** Bytes that start like a PNG and carry no image. What a dropped connection leaves behind. */
val TRUNCATED_PNG: ByteArray = TEST_PNG.copyOfRange(0, 9)
