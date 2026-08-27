/*
 * Copyright (c) Jaime Elso de Blas (https://jaimeelso.com)
 * This code is licensed under the MIT license.
 *
 * Minimal unit tests for the pure/mockable parts of lambda.mjs: input validation, the
 * honeypot check, and Turnstile verification (with the global fetch mocked). Anything
 * that depends on Secrets Manager or SNS at module load time (init(), publishMessageToSNS,
 * the handler itself) is out of scope here, since it would require real AWS credentials.
*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateInput, isHoneypotFilled, verifyTurnstile } from './lambda.mjs';

const validInput = () => ({
	mail: 'user@example.com',
	subject: 'Hello there',
	message: 'This is a message long enough to pass validation.',
	token: 'token-value',
	website: ''
});

test('validateInput accepts a well-formed submission and sanitizes it', () => {
	const result = validateInput(validInput());
	assert.equal(result.mail, 'user@example.com');
	assert.equal(result.subject, 'Hello there');
});

test('validateInput rejects a missing required field', () => {
	const input = validInput();
	delete input.mail;
	assert.equal(validateInput(input), false);
});

test('validateInput rejects an invalid email', () => {
	const input = validInput();
	input.mail = 'not-an-email';
	assert.equal(validateInput(input), false);
});

test('validateInput rejects a subject shorter than 4 characters', () => {
	const input = validInput();
	input.subject = 'Hi';
	assert.equal(validateInput(input), false);
});

test('validateInput rejects a subject longer than 100 characters', () => {
	const input = validInput();
	input.subject = 'a'.repeat(101);
	assert.equal(validateInput(input), false);
});

test('validateInput rejects a message shorter than 20 characters', () => {
	const input = validInput();
	input.message = 'too short';
	assert.equal(validateInput(input), false);
});

test('validateInput rejects a message longer than 1000 characters', () => {
	const input = validInput();
	input.message = 'a'.repeat(1001);
	assert.equal(validateInput(input), false);
});

test('validateInput rejects a non-object input', () => {
	assert.equal(validateInput('not an object'), false);
});

test('validateInput sanitizes angle brackets in the sanitized fields', () => {
	const input = validInput();
	input.subject = '<script>alert(1)</script>';
	const result = validateInput(input);
	assert.equal(result.subject.includes('<'), false);
	assert.equal(result.subject.includes('&lt;'), true);
});

test('isHoneypotFilled returns false when the field is empty', () => {
	assert.equal(isHoneypotFilled({ website: '' }), false);
});

test('isHoneypotFilled returns false when the field is missing', () => {
	assert.equal(isHoneypotFilled({}), false);
});

test('isHoneypotFilled returns false for a null/undefined body', () => {
	assert.equal(isHoneypotFilled(null), false);
	assert.equal(isHoneypotFilled(undefined), false);
});

test('isHoneypotFilled returns true when the field is filled in', () => {
	assert.equal(isHoneypotFilled({ website: 'http://spam.example' }), true);
});

test('verifyTurnstile rejects a non-string token', async () => {
	await assert.rejects(() => verifyTurnstile(123));
});

test('verifyTurnstile returns true when Turnstile reports success', async (t) => {
	t.mock.method(globalThis, 'fetch', async (url) => {
		assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
		return { json: async () => ({ success: true }) };
	});
	assert.equal(await verifyTurnstile('valid-token'), true);
});

test('verifyTurnstile returns false when Turnstile reports failure', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => ({ json: async () => ({ success: false }) }));
	assert.equal(await verifyTurnstile('invalid-token'), false);
});

test('verifyTurnstile throws when it cannot reach the Turnstile server', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
	await assert.rejects(() => verifyTurnstile('any-token'));
});
