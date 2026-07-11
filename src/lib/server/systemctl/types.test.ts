import { describe, it, expect } from 'vitest';
import {
	isValidUnitName,
	UNIT_NAME_PATTERN,
	isValidUnitBase,
	buildUnitName,
	unitNameBase
} from './types';

describe('isValidUnitName', () => {
	it('accepts a well-formed game-*.service unit name', () => {
		expect(isValidUnitName('game-minecraft.service')).toBe(true);
	});

	it('accepts allowed special characters (dot, underscore, at-sign, hyphen)', () => {
		expect(isValidUnitName('game-my_server.v2@1-test.service')).toBe(true);
	});

	it('rejects shell metacharacter injection attempts', () => {
		expect(isValidUnitName('game-a;rm -rf /.service')).toBe(false);
		expect(isValidUnitName('game-a && reboot.service')).toBe(false);
		expect(isValidUnitName('game-a`whoami`.service')).toBe(false);
		expect(isValidUnitName('game-a$(whoami).service')).toBe(false);
		expect(isValidUnitName('game-a|cat.service')).toBe(false);
	});

	it('rejects glob wildcards (would match unintended units)', () => {
		expect(isValidUnitName('game-*.service')).toBe(false);
	});

	it('rejects any name that does not literally start with "game-" (defeats leading-dash/flag-injection attempts, since the mandatory prefix means the argv value can never start with "-")', () => {
		expect(isValidUnitName('-game-x.service')).toBe(false);
		expect(isValidUnitName('--force.service')).toBe(false);
	});

	it('rejects names missing the game- prefix', () => {
		expect(isValidUnitName('minecraft.service')).toBe(false);
		expect(isValidUnitName('other-minecraft.service')).toBe(false);
	});

	it('rejects names missing the .service suffix', () => {
		expect(isValidUnitName('game-minecraft')).toBe(false);
		expect(isValidUnitName('game-minecraft.timer')).toBe(false);
	});

	it('rejects an empty or whitespace-only unit name', () => {
		expect(isValidUnitName('')).toBe(false);
		expect(isValidUnitName('game- .service')).toBe(false);
	});

	it('exposes the same pattern used for validation', () => {
		expect(UNIT_NAME_PATTERN.test('game-valid.service')).toBe(true);
	});
});

describe('unit-name middle helpers', () => {
	it('accepts a valid middle part and rejects empty/whitespace/metacharacters', () => {
		expect(isValidUnitBase('minecraft')).toBe(true);
		expect(isValidUnitBase('my_server.v2@1-test')).toBe(true);
		expect(isValidUnitBase('')).toBe(false);
		expect(isValidUnitBase(' ')).toBe(false);
		expect(isValidUnitBase('a b')).toBe(false);
		expect(isValidUnitBase('a;rm')).toBe(false);
		expect(isValidUnitBase('*')).toBe(false);
	});

	it('builds a full unit name that always passes isValidUnitName for any valid base', () => {
		expect(buildUnitName('minecraft')).toBe('game-minecraft.service');
		expect(isValidUnitName(buildUnitName('my_server.v2@1-test'))).toBe(true);
	});

	it('extracts the middle part for pre-filling the edit form, round-tripping with buildUnitName', () => {
		expect(unitNameBase('game-minecraft.service')).toBe('minecraft');
		expect(buildUnitName(unitNameBase('game-valheim.service'))).toBe('game-valheim.service');
	});

	it('returns a non-conforming stored name unchanged rather than mangling it', () => {
		expect(unitNameBase('legacy.service')).toBe('legacy.service');
		expect(unitNameBase('game-x')).toBe('game-x');
	});
});
