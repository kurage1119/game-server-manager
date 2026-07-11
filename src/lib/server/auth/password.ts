import { hash, verify } from '@node-rs/argon2';
import { randomInt } from 'node:crypto';

// @node-rs/argon2's `Algorithm` is a `declare const enum`, which can't be
// imported as a value under SvelteKit's verbatimModuleSyntax tsconfig (each
// file is transpiled in isolation, so const-enum inlining isn't available).
// 2 = Algorithm.Argon2id, per node_modules/@node-rs/argon2/index.d.ts.
const ARGON2ID = 2;

/**
 * argon2id, using the @node-rs/argon2 defaults (4 MiB memory, 3 iterations,
 * 1 thread) — reasonable for a small self-hosted tool. Isolated here so it can
 * be swapped for bcryptjs later (see docs/implementation-plan.md risk notes)
 * without touching any call site.
 */
export async function hashPassword(password: string): Promise<string> {
	return hash(password, { algorithm: ARGON2ID });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	return verify(passwordHash, password);
}

// Characters chosen to avoid visually-confusable glyphs (l/1, O/0, I) since this
// string is read off a screen and typed in by hand for a forced first login.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 12;

/** Generates a 12-character random temporary password using a CSPRNG. */
export function generateTempPassword(): string {
	let result = '';
	for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
		result += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
	}
	return result;
}
