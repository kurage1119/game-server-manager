import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, generateTempPassword } from './password';

describe('hashPassword / verifyPassword', () => {
	it('produces an argon2id hash that verifies against the original password', async () => {
		const hash = await hashPassword('correct horse battery staple');
		expect(hash).toMatch(/^\$argon2id\$/);
		await expect(verifyPassword(hash, 'correct horse battery staple')).resolves.toBe(true);
	});

	it('rejects an incorrect password', async () => {
		const hash = await hashPassword('correct horse battery staple');
		await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
	});

	it('produces a different hash each time (random salt)', async () => {
		const a = await hashPassword('same-password');
		const b = await hashPassword('same-password');
		expect(a).not.toBe(b);
	});
});

describe('generateTempPassword', () => {
	it('generates a 12-character password', () => {
		expect(generateTempPassword()).toHaveLength(12);
	});

	it('excludes visually-confusable characters (l, 1, I, O, 0)', () => {
		for (let i = 0; i < 200; i++) {
			const password = generateTempPassword();
			expect(password).not.toMatch(/[l1IO0]/);
		}
	});

	it('generates different passwords across calls', () => {
		const passwords = new Set(Array.from({ length: 50 }, () => generateTempPassword()));
		expect(passwords.size).toBeGreaterThan(1);
	});
});
